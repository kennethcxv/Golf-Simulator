// FAIRWAY STATE — the local golfer pool.
// These are the persistent people of the game. Phase 3 gives them identity, wealth,
// a picky-about persona, membership status, and a satisfaction number the club
// economy moves. Phase 5 deepens the SAME records with memory, thoughts, rounds
// played, and skill evolution — never a parallel system.

import { rngOf } from '../core/utils.js';
import { genName } from '../data/names.js';

export const PERSONAS = ['conditions', 'value', 'pace', 'service', 'shop'];

export function initGolfers(state, poolSize = 140) {
  const rng = rngOf(state);
  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    // wealth 1..4, skewed toward modest
    const wr = rng.next();
    const wealth = wr < 0.32 ? 1 : wr < 0.72 ? 2 : wr < 0.92 ? 3 : 4;
    pool.push({
      id: i + 1,
      name: genName(rng),
      wealth,
      persona: PERSONAS[rng.int(PERSONAS.length)],
      skill: 8 + rng.int(20), // handicap-ish, Phase 5 evolves it
      memberTier: null,
      satisfaction: 48 + rng.int(14),
      joinedDay: -1,
      lastVisitDay: -1,
    });
  }

  // a muni has some existing regulars: seed a starting membership
  const byWealthDesc = [...pool].sort((a, b) => b.wealth - a.wealth);
  let premium = 0;
  let full = 0;
  let weekday = 0;
  for (const g of byWealthDesc) {
    if (premium < 2 && g.wealth >= 3) { g.memberTier = 'premium'; g.joinedDay = 0; premium++; continue; }
    if (full < 8 && g.wealth >= 2) { g.memberTier = 'full'; g.joinedDay = 0; full++; continue; }
    if (weekday < 12) { g.memberTier = 'weekday'; g.joinedDay = 0; weekday++; continue; }
    if (premium >= 2 && full >= 8 && weekday >= 12) break;
  }

  state.golfers = { pool, nextId: poolSize + 1 };
}

export function members(state) {
  return state.golfers.pool.filter((g) => g.memberTier);
}

export function nonMembers(state) {
  return state.golfers.pool.filter((g) => !g.memberTier);
}
