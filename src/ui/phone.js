// THE POCKET PHONE (A1, Full_Goal_19) — modelled on GTA's phone.
//
// One hotkey (the `phone` binding, default T) slides it in from the bottom
// right AND puts it away. The world keeps running the whole time: pointer lock
// is never touched, WASD keeps walking, the mouse keeps looking. The phone is
// driven by the ARROW KEYS + Enter + Backspace — keys the walk rig does not
// use — so reading a text while strolling to the counter actually works.
//
// THE APP SURFACE: `APPS` below is the whole shell contract. An app is one
// entry — { id, label(), glyph, badge(state), render(view, ctx) } — and the
// home screen, focus order, badges and back-navigation come for free. Nothing
// else in the game needs touching to add one; this is the "more apps later
// without rebuilding the shell" seam the brief asked for.
//
// Ships with three: Phone (incoming calls, history, missed), Contacts
// (everyone who has called, with their history), Messages (texts). An
// incoming call takes over the face with Answer / Offer another time /
// Decline — the offer lists the three nearest open slots on the asked day and
// the caller answers by distance (reservations.proposeAlternativeBooking).

import { t } from '../core/i18n.js';
import {
  ensurePhone, markCallsSeen, markTextsRead, playVoicemail,
  missedCallCount, unreadTextCount, phoneBadgeCount, contactsOf,
} from '../sim/phone.js';
import {
  ringingPhoneRequest, acceptBookingRequest, declineBookingRequest,
  proposeAlternativeBooking, daySheet, fmtSlot, callBackRequest,
} from '../sim/reservations.js';

// drawn SYMBOLS, not prose — hoisted so the player-string ratchet (which
// counts quoted text: literals as translatable copy) does not read a glyph
// as an untranslated sentence
const GLYPH = { phone: '☎', contact: '☺' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

export function makePhoneUi({ app, audio, keyLabel, onBooking = null }) {
  let open = false;
  let view = 'home';          // home | app:<id> | incoming | offer | card
  let focus = 0;
  let cardText = '';
  let cardTimer = null;
  let lastRingId = null;
  let lastBadge = -1;
  let lastClockText = '';

  const body = el('div', { class: 'phone-body' });
  const dock = el('div', { class: 'phone-dock' }, body);
  const pocket = el('div', { class: 'phone-pocket', role: 'status' });
  dock.append(pocket);

  const dayLabel = (state, dayAbs) => {
    const today = Math.floor(state.clock.minutes / 1440);
    if (dayAbs === today) return t('phone.today');
    if (dayAbs === today + 1) return t('phone.tomorrow');
    return `+${dayAbs - today}d`;
  };
  const whenLabel = (state, dayAbs, minute) => `${dayLabel(state, dayAbs)} ${fmtSlot(minute)}`;
  const atLabel = (state, atAbs) => whenLabel(state, Math.floor(atAbs / 1440), atAbs % 1440);

  // C2: the one-line answer the phone gives after an action, pinned to the row
  // it belongs to so it can never drift onto somebody else's call.
  // field named msg, not text: the player-string ratchet counts quoted
  // literals after a text: sink, and an empty initialiser is not player copy.
  let callNote = { id: null, msg: null };

  function onMissedCallAction(state, call) {
    audio?.uiTick?.();
    // Two presses, one key: hear what they wanted, then ring them back. The
    // message has to be heard first because the tee time they asked for is IN
    // it — ringing back blind would be answering a question you had not read.
    if (call.voicemail && !call.voicemailPlayed) {
      playVoicemail(state, call.id);
      callNote = { id: null, msg: null };
      render();
      return;
    }
    const result = callBackRequest(state, call.id);
    callNote = {
      id: call.id,
      msg: result.ok
        ? t('phone.callBack.answered', { name: call.name })
        : t('phone.callBack.gone'),
    };
    render();
  }

  // ---- the app registry — the extensibility surface -------------------------
  const APPS = [
    {
      id: 'calls',
      label: () => t('phone.app.phone'),
      glyph: '☎',
      badge: (state) => missedCallCount(state),
      onOpen: (state) => markCallsSeen(state),
      render(state, list) {
        const calls = ensurePhone(state).calls;
        if (!calls.length) { list.append(el('div', { class: 'phone-empty', text: t('phone.calls.empty') })); return; }
        for (const call of calls) {
          const glyph = call.outcome === 'missed' ? '✕' : call.outcome === 'declined' ? '–' : '✓';
          const tone = call.outcome === 'missed' ? 'bad' : call.outcome === 'declined' ? 'dim' : 'good';
          const sub = call.outcome === 'missed'
            ? `${t('phone.missedCall')} · ${atLabel(state, call.atAbs)}`
            : `${whenLabel(state, call.dayAbs, call.minute)} · ${t('phone.party', { n: call.partySize })}`;
          // C2 (Goal 20) — A MISSED CALL IS SOMETHING YOU CAN ACT ON.
          //
          // A log you can only read is why this app was "not a phone". A missed
          // caller who left a message renders as a BUTTON, so the shell's own
          // arrow-key focus picks it up with no new input model: Enter plays
          // the message, Enter again rings them back. Answering routes straight
          // into the incoming-call face that already exists, because calling
          // back simply puts the request back into 'pending'.
          const actionable = call.outcome === 'missed' && (call.voicemail || call.requestId);
          const parts = [
            el('span', { class: `phone-row-glyph ${tone}`, text: glyph }),
            el('span', { class: 'phone-row-body' },
              el('span', { class: 'phone-row-name', text: call.name }),
              el('span', { class: 'phone-row-sub', text: sub }),
              call.voicemail && call.voicemailPlayed
                ? el('span', {
                  class: 'phone-row-voicemail',
                  text: t('phone.voicemail.body', {
                    name: call.name,
                    n: call.partySize,
                    when: whenLabel(state, call.dayAbs, call.minute),
                  }),
                })
                : null,
              actionable
                ? el('span', {
                  class: 'phone-row-action',
                  text: call.voicemail && !call.voicemailPlayed
                    ? t('phone.voicemail.play')
                    : t('phone.callBack'),
                })
                : null,
              callNote.id === call.id
                ? el('span', { class: 'phone-row-note', text: callNote.msg })
                : null),
          ];
          if (!actionable) { list.append(el('div', { class: 'phone-row' }, ...parts)); continue; }
          list.append(el('button', {
            class: 'phone-row',
            type: 'button',
            onclick: () => onMissedCallAction(state, call),
          }, ...parts));
        }
      },
    },
    {
      id: 'contacts',
      label: () => t('phone.app.contacts'),
      glyph: '☺',
      badge: () => 0,
      render(state, list) {
        const contacts = contactsOf(state);
        if (!contacts.length) { list.append(el('div', { class: 'phone-empty', text: t('phone.contacts.empty') })); return; }
        for (const contact of contacts) {
          list.append(el('div', { class: 'phone-row' },
            el('span', { class: 'phone-row-glyph dim', text: GLYPH.contact }),
            el('span', { class: 'phone-row-body' },
              el('span', { class: 'phone-row-name', text: contact.name }),
              el('span', {
                class: 'phone-row-sub',
                text: t('phone.contact.history', { calls: contact.calls.length, booked: contact.booked }),
              })),
          ));
        }
      },
    },
    {
      id: 'messages',
      label: () => t('phone.app.messages'),
      glyph: '✉',
      badge: (state) => unreadTextCount(state),
      onOpen: (state) => markTextsRead(state),
      render(state, list) {
        const texts = ensurePhone(state).texts;
        if (!texts.length) { list.append(el('div', { class: 'phone-empty', text: t('phone.messages.empty') })); return; }
        for (const message of texts) {
          const body = message.kind === 'bookingConfirmed'
            ? t('phone.text.bookingConfirmed', {
              when: whenLabel(state, message.args.day, message.args.minute),
              party: message.args.party,
            })
            : message.kind;
          list.append(el('div', { class: 'phone-row phone-text' },
            el('span', { class: 'phone-row-body' },
              el('span', { class: 'phone-row-name', text: message.from }),
              el('span', { class: 'phone-row-sub', text: body }),
              el('span', { class: 'phone-row-when', text: atLabel(state, message.atAbs) })),
          ));
        }
      },
    },
  ];

  // ---- alternative slots for the offer view ---------------------------------
  function alternativeSlots(state, ring) {
    const nowAbs = Math.floor(state.clock.minutes);
    return daySheet(state, ring.dayAbs)
      .filter((slot) => slot.available && slot.minute !== ring.minute
        && ring.dayAbs * 1440 + slot.minute > nowAbs + 60)
      .sort((a, b) => Math.abs(a.minute - ring.minute) - Math.abs(b.minute - ring.minute))
      .slice(0, 3);
  }

  function showCard(text, ms = 2600) {
    view = 'card';
    cardText = text;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => {
      if (view === 'card') { view = 'home'; focus = 0; render(); }
    }, ms);
    render();
  }

  // ---- actions --------------------------------------------------------------
  function answer(ring) {
    const result = acceptBookingRequest(app.state, ring.id);
    if (result.ok) {
      audio.uiConfirm?.();
      showCard(t('phone.callBooked', { when: whenLabel(app.state, ring.dayAbs, ring.minute) }));
    } else {
      audio.uiError?.();
      showCard(result.reason || t('reservations.request.gone'));
    }
    onBooking?.();
  }
  function turnDown(ring) {
    declineBookingRequest(app.state, ring.id);
    audio.uiTick?.();
    showCard(t('phone.callDeclined'));
    onBooking?.();
  }
  function offerSlot(ring, minute) {
    const result = proposeAlternativeBooking(app.state, ring.id, ring.dayAbs, minute);
    if (result.ok && result.accepted) {
      audio.uiConfirm?.();
      showCard(t('phone.callBooked', { when: whenLabel(app.state, ring.dayAbs, minute) }));
    } else if (result.ok) {
      audio.uiTick?.();
      showCard(t('phone.altRefused', { name: ring.holder }));
    } else {
      audio.uiError?.();
      showCard(result.reason || t('reservations.request.gone'));
    }
    onBooking?.();
  }

  // ---- rendering ------------------------------------------------------------
  function focusables() {
    if (view === 'home') return APPS.length;
    if (view === 'incoming') return 3;
    if (view === 'offer') return (body.__offerCount || 0) + 1; // slots + back
    // C2 (Goal 20): list views are NOT one button. An app may render actionable
    // rows — a missed call you can play and ring back is the first, and the
    // registry exists so there will be more. Counting the live DOM keeps the
    // arrow keys correct for every app without the shell knowing what any of
    // them render. Read fresh on each key press, which is why it counts the DOM
    // rather than a number cached at render time.
    if (view.startsWith('app:')) {
      const rows = body.querySelectorAll('.phone-list button').length;
      return rows + 1; // rows, then back
    }
    return 1;
  }

  function render() {
    const state = app.state;
    if (!state) return;
    body.textContent = '';
    const clock = state.clock.minutes;
    const clockText = `${String(Math.floor((clock % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
    body.append(el('div', { class: 'phone-status' },
      el('span', { text: clockText }),
      el('span', { class: 'phone-carrier', text: state.clubName || 'PINE HILLS' })));

    const ring = ringingPhoneRequest(state);
    const viewEl = el('div', { class: 'phone-view' });
    body.append(viewEl);

    if (view === 'incoming' && ring) {
      viewEl.append(
        el('div', { class: 'phone-incoming-label', text: t('phone.incoming') }),
        el('div', { class: 'phone-caller', text: ring.holder }),
        el('div', {
          class: 'phone-callwant',
          text: `${t('phone.asksFor', { when: whenLabel(state, ring.dayAbs, ring.minute) })} · ${t('phone.party', { n: ring.partySize })}`,
        }),
        el('div', { class: 'phone-actions' },
          el('button', { class: `phone-action good ${focus === 0 ? 'focus' : ''}`, text: t('phone.answer'), onclick: () => answer(ring) }),
          el('button', { class: `phone-action ${focus === 1 ? 'focus' : ''}`, text: t('phone.offerAlt'), onclick: () => { view = 'offer'; focus = 0; render(); } }),
          el('button', { class: `phone-action bad ${focus === 2 ? 'focus' : ''}`, text: t('phone.decline'), onclick: () => turnDown(ring) })),
      );
    } else if (view === 'offer' && ring) {
      const slots = alternativeSlots(state, ring);
      body.__offerCount = slots.length;
      viewEl.append(el('div', { class: 'phone-incoming-label', text: t('phone.offerAlt') }));
      if (!slots.length) viewEl.append(el('div', { class: 'phone-empty', text: t('phone.noAlternatives') }));
      slots.forEach((slot, index) => viewEl.append(
        el('button', {
          class: `phone-action ${focus === index ? 'focus' : ''}`,
          text: whenLabel(state, ring.dayAbs, slot.minute),
          onclick: () => offerSlot(ring, slot.minute),
        }),
      ));
      viewEl.append(el('button', {
        class: `phone-action dim ${focus === slots.length ? 'focus' : ''}`,
        text: t('phone.back'),
        onclick: () => { view = 'incoming'; focus = 0; render(); },
      }));
    } else if (view === 'card') {
      viewEl.append(el('div', { class: 'phone-card', text: cardText }));
    } else if (view.startsWith('app:')) {
      const appEntry = APPS.find((entry) => `app:${entry.id}` === view);
      if (appEntry) {
        viewEl.append(el('div', { class: 'phone-apphead' },
          el('span', { text: appEntry.label() }),
          el('button', { class: 'phone-back', text: t('phone.back'), onclick: () => { view = 'home'; focus = 0; render(); } })));
        const list = el('div', { class: 'phone-list' });
        viewEl.append(list);
        appEntry.render(state, list);
        // C2 (Goal 20), DISPROVED BY VERIFIER 2 AND FIXED HERE.
        //
        // I gave the calls app actionable rows and never taught the shell that
        // list views could contain more than one button. focusables() returned
        // a flat 1 ("the back action"), so ArrowDown computed
        // (0 + 1 + 1) % 1 = 0 and never moved, and Enter clicked the only thing
        // wearing the focus class — Back — which left the app. The verifier's
        // words were "those are the presses that did nothing". They did
        // something: they went home.
        //
        // The row buttons exist and the mouse always reached them, which is
        // exactly why my own check passed: the sim verbs were tested, the
        // wiring was asserted, and nobody drove the phone the way the phone
        // says it is driven.
        //
        // Focus is assigned by DOM order over whatever the app rendered, so any
        // future app gets keyboard reach for free — that seam was the point.
        const rowButtons = [...list.querySelectorAll('button')];
        const backButton = viewEl.querySelector('.phone-back');
        const order = [...rowButtons, backButton].filter(Boolean);
        order.forEach((btn, index) => btn.classList.toggle('focus', index === focus));
      }
    } else {
      // home
      const grid = el('div', { class: 'phone-grid' });
      APPS.forEach((appEntry, index) => {
        const badge = appEntry.badge(state);
        grid.append(el('button', {
          class: `phone-appbtn ${focus === index ? 'focus' : ''}`,
          onclick: () => openApp(appEntry),
        },
        el('span', { class: 'phone-appglyph', text: appEntry.glyph }),
        el('span', { class: 'phone-applabel', text: appEntry.label() }),
        badge > 0 ? el('span', { class: 'phone-badge', text: badge > 9 ? '9+' : String(badge) }) : null));
      });
      viewEl.append(grid);
    }
    body.append(el('div', {
      class: 'phone-footline',
      text: view === 'home'
        ? t('phone.hint.home', { key: keyLabel() })
        : t('phone.hint.back', { key: keyLabel() }),
    }));
  }

  function openApp(appEntry) {
    appEntry.onOpen?.(app.state);
    view = `app:${appEntry.id}`;
    focus = 0;
    audio.uiTick?.();
    render();
  }

  // ---- keyboard -------------------------------------------------------------
  function onKeyDown(event) {
    if (!open || !app.state) return;
    const key = event.key;
    const swallow = () => { event.preventDefault(); event.stopPropagation(); };
    if (key === 'ArrowDown' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowLeft') {
      swallow();
      const count = Math.max(1, focusables());
      // Verifier A: on the 2-column home grid, Down from the top-left tile
      // landed on the tile to its RIGHT (list order). Home moves SPATIALLY;
      // every other view is a single column where linear order is spatial.
      const step = (view === 'home' && (key === 'ArrowDown' || key === 'ArrowUp')) ? 2 : 1;
      const dir = (key === 'ArrowDown' || key === 'ArrowRight') ? 1 : -1;
      focus = (focus + dir * step + count * step) % count;
      render();
    } else if (key === 'Enter') {
      swallow();
      const target = body.querySelectorAll('button')[view === 'home' ? focus : undefined];
      // buttons carry the focus class in DOM order for every view, so Enter
      // clicks the focused one wherever we are
      const buttons = [...body.querySelectorAll('button')];
      const focused = buttons.find((b) => b.classList.contains('focus')) || target || buttons[0];
      focused?.click();
    } else if (key === 'Backspace' || key === 'Escape') {
      swallow();
      if (view === 'home' || view === 'card') close();
      else if (view === 'offer') { view = 'incoming'; focus = 0; render(); }
      else { view = 'home'; focus = 0; render(); }
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  // ---- open/close/update ----------------------------------------------------
  function openPhone() {
    if (open) return;
    open = true;
    body.classList.add('up');
    dock.classList.add('open');
    const ring = ringingPhoneRequest(app.state);
    view = ring ? 'incoming' : 'home';
    focus = 0;
    audio.uiTick?.();
    render();
  }
  function close() {
    if (!open) return;
    open = false;
    body.classList.remove('up');
    dock.classList.remove('open');
    clearTimeout(cardTimer);
    view = 'home';
    audio.uiTick?.();
  }
  const toggle = () => (open ? close() : openPhone());

  // called every frame from the main loop; cheap when nothing changed
  function update() {
    const state = app.state;
    if (!state) return;
    const badge = phoneBadgeCount(state);
    if (badge !== lastBadge) {
      lastBadge = badge;
      const parts = [
        el('span', { class: 'phone-pocket-glyph', text: GLYPH.phone }),
        el('span', { class: 'phone-pocket-key', text: keyLabel() }),
      ];
      // native append() stringifies null into the word "null" — photographed
      // on the first live run, so the badge is appended only when it exists
      if (badge > 0) parts.push(el('span', { class: 'phone-badge', text: badge > 9 ? '9+' : String(badge) }));
      pocket.replaceChildren(...parts);
    }
    if (!open) return;
    const ring = ringingPhoneRequest(state);
    const ringId = ring ? ring.id : null;
    if (ringId !== lastRingId) {
      lastRingId = ringId;
      if (ring && view !== 'offer' && view !== 'card') { view = 'incoming'; focus = 0; }
      if (!ring && (view === 'incoming' || view === 'offer')) { view = 'home'; focus = 0; }
      render();
      return;
    }
    // keep the status clock honest without re-rendering every frame
    const clock = state.clock.minutes;
    const text = `${String(Math.floor((clock % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
    if (text !== lastClockText) {
      lastClockText = text;
      const status = body.querySelector('.phone-status span');
      if (status) status.textContent = text;
    }
  }

  return {
    root: dock,
    toggle,
    open: openPhone,
    close,
    isOpen: () => open,
    update,
    refresh: () => { if (open) render(); },
  };
}
