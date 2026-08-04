// EVERY SIGN THAT SAYS OPEN OR CLOSED, DRIVEN FROM ONE FACT.
//
// There were two of them and only one turned. The interior card read
// signIsOpen(state) and swung on E; the exterior board on the south wall —
// `LegacyBusinessHoursSign`, the one a customer actually walks past — was
// repainted from campaignAllowsBusiness(), a campaign MILESTONE that is
// permanently true in a non-campaign game. So it read "OPEN TODAY / 6 AM–8 PM"
// all night, every night, whatever the player had done with the card indoors.
//
// The interior card had a quieter version of the same fault: applyFacing() ran
// at build and on the E press and nowhere else, so the midnight rollover
// (state.js -> closeSignForNewDay) set signOpen false while the card stayed
// turned to OPEN until someone pressed E twice.
//
// The shape of both bugs is the same: a sign whose paint is pushed at it from
// whichever caller happened to think of it. This module inverts that. A sign
// registers what it can do about being open or closed, and ONE tick reads
// signIsOpen(state) and tells every registered sign at once. A sign that is not
// in the registry is not driven by anything, which is a condition
// tests/shop-sign.test.js can — and does — check by name.

import { signIsOpen } from '../../sim/shopSign.js';

/**
 * A registry, not a singleton: one per built clubhouse, so two scenes in one
 * process (tests do this) cannot repaint each other's boards.
 */
export function createOpenClosedSignRegistry() {
  const signs = new Map();
  // undefined rather than false — the first sync must paint even a shop that
  // starts CLOSED, or a fresh scene shows whatever the builder happened to bake.
  let lastOpen;
  let lastEstablished;

  return {
    /**
     * @param {string} name  the object3D name, so a diagnostic can be matched
     *                       against the scene graph rather than trusted
     * @param {(facts:{open:boolean, established:boolean}) => void} apply
     */
    register(name, apply) {
      if (typeof name !== 'string' || !name) throw new Error('sign needs a name');
      if (typeof apply !== 'function') throw new Error(`sign ${name} needs an apply()`);
      if (signs.has(name)) throw new Error(`sign ${name} registered twice`);
      signs.set(name, apply);
      // Paint it immediately IF the registry has already run once, so a sign
      // built late (a variant swap, a campaign facility) is never a frame stale.
      if (lastOpen !== undefined) apply({ open: lastOpen, established: lastEstablished });
    },

    /**
     * Called every frame from the clubhouse update. Cheap: it compares the two
     * facts and returns without touching a canvas when nothing has moved, so
     * the per-frame cost of the guarantee is two boolean compares.
     *
     * `established` is the campaign's "this business exists at all" milestone.
     * It is NOT the daily sign, and conflating the two is what caused the bug.
     */
    sync(state, established = true) {
      const open = signIsOpen(state);
      const est = !!established;
      if (open === lastOpen && est === lastEstablished) return false;
      lastOpen = open;
      lastEstablished = est;
      for (const apply of signs.values()) apply({ open, established: est });
      return true;
    },

    diagnostics() {
      return {
        names: [...signs.keys()],
        open: lastOpen ?? null,
        established: lastEstablished ?? null,
      };
    },
  };
}

/**
 * What the street-facing board says.
 *
 * `open` DECIDES IT, always. The first draft of this function let `established`
 * (the campaign's one-time "this business exists" milestone) win, which read
 * well on paper and reproduced the original bug exactly: the greybox starter is
 * a campaign profile with businessOpen false, so the board sat on CLOSED /
 * RESTORATION while the player flipped the card indoors and served customers.
 * Measured by tools/qa/shop-sign-both.js — the board's canvas hash did not move
 * across a real E press. Customers arrive on shopAcceptsWalkIns(), which asks
 * the card and the clock and nothing about the campaign; the board must answer
 * the same question they do.
 *
 * `established` only picks between two ways of being shut, which is a real
 * distinction: a shop mid-restoration and a shop that shut at eight are not the
 * same thing to read from the car park.
 */
export function exteriorSignFace({ open, established }) {
  if (open) {
    return {
      key: 'open',
      lines: ['PRO SHOP', 'OPEN TODAY', '6 AM – 8 PM'],
      field: '#f4f0e6',
      ink: '#1f4a26',
      secondaryInk: '#3f3a30',
    };
  }
  if (!established) {
    return {
      key: 'restoration',
      lines: ['PRO SHOP', 'CLOSED', 'RESTORATION'],
      field: '#e8dfcb',
      ink: '#473c31',
      secondaryInk: '#8a4d3a',
    };
  }
  // Deadpan, and the same words as the card indoors — one shop, one voice.
  return {
    key: 'closed',
    lines: ['PRO SHOP', 'CLOSED', 'BACK SOON'],
    field: '#efe7d6',
    ink: '#6b2f28',
    secondaryInk: '#4a4239',
  };
}
