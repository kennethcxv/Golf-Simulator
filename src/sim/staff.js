// FAIRWAY STATE — staff: hiring market, payroll, training, and what skill buys.
// Groundskeepers convert skill into real crew-hours for the turf sim; instructors
// unlock lessons and (Phase 5) member skill growth; F&B staff lift the restaurant.
// Day-labor (maintenance.crewUnits) remains as supplemental unskilled hours.

import { rngOf } from '../core/utils.js';
import { genName } from '../data/names.js';
import { spend } from './economy.js';
import { BALANCE } from './balance.js';

export const ROLE = {
  GROUNDSKEEPER: 'groundskeeper',
  INSTRUCTOR: 'instructor',
  FNB: 'fnb',
  PROSHOP: 'proshop',
};

const ROLE_BASE_WAGE = { groundskeeper: 105, instructor: 150, fnb: 95, proshop: 100 };

export function wageForSkill(role, skill) {
  return Math.round((ROLE_BASE_WAGE[role] || 100) * (0.62 + 0.19 * skill));
}

function genCandidate(state, id) {
  const rng = rngOf(state);
  const roll = rng.next();
  const role = roll < 0.38 ? ROLE.GROUNDSKEEPER : roll < 0.58 ? ROLE.INSTRUCTOR : roll < 0.8 ? ROLE.FNB : ROLE.PROSHOP;
  const skill = 1 + rng.int(4) + (rng.chance(0.15) ? 1 : 0); // 1..5, 5 rare
  return {
    id,
    name: genName(rng),
    role,
    skill: Math.min(5, skill),
    wage: wageForSkill(role, Math.min(5, skill)),
    trainingDays: 0,
  };
}

export function initStaff(state) {
  state.staff = { employees: [], market: [], nextId: 1, marketDay: 0 };
  regenerateMarket(state);
}

function regenerateMarket(state) {
  const rng = rngOf(state);
  const n = 4 + rng.int(3);
  state.staff.market = [];
  for (let i = 0; i < n; i++) {
    state.staff.market.push(genCandidate(state, state.staff.nextId++));
  }
}

export function refreshMarketIfDue(state, dayAbs) {
  if (dayAbs - state.staff.marketDay >= 6) {
    state.staff.marketDay = dayAbs;
    regenerateMarket(state);
  }
}

export function hireStaff(state, candidateId) {
  const i = state.staff.market.findIndex((c) => c.id === candidateId);
  if (i === -1) return { ok: false, reason: 'Candidate gone.' };
  const [candidate] = state.staff.market.splice(i, 1);
  state.staff.employees.push(candidate);
  return { ok: true, employee: candidate };
}

export function fireStaff(state, employeeId) {
  const i = state.staff.employees.findIndex((e) => e.id === employeeId);
  if (i === -1) return { ok: false, reason: 'No such employee.' };
  const [emp] = state.staff.employees.splice(i, 1);
  const severance = emp.wage * 3;
  spend(state, 'severance', severance);
  return { ok: true, severance };
}

export function trainStaff(state, employeeId) {
  const emp = state.staff.employees.find((e) => e.id === employeeId);
  if (!emp) return { ok: false, reason: 'No such employee.' };
  if (emp.trainingDays > 0) return { ok: false, reason: 'Already in training.' };
  if (emp.skill >= 5) return { ok: false, reason: 'Already a master.' };
  const cost = 200 + emp.skill * 120;
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash for the course fee.' };
  spend(state, 'training', cost);
  emp.trainingDays = 2;
  return { ok: true, cost };
}

export function tickStaffDaily(state) {
  for (const emp of state.staff.employees) {
    if (emp.trainingDays > 0) {
      emp.trainingDays--;
      if (emp.trainingDays === 0) {
        emp.skill = Math.min(5, Math.round((emp.skill + 0.5) * 10) / 10);
        emp.wage = wageForSkill(emp.role, emp.skill);
      }
    }
  }
}

export function staffDailyWages(state) {
  return state.staff ? state.staff.employees.reduce((a, e) => a + e.wage, 0) : 0;
}

export function staffByRole(state, role, { available = false } = {}) {
  if (!state.staff) return [];
  return state.staff.employees.filter((e) => e.role === role && (!available || e.trainingDays === 0));
}

export function bestSkill(state, role) {
  const list = staffByRole(state, role, { available: true });
  return list.length ? Math.max(...list.map((e) => e.skill)) : 0;
}

// Real crew capacity: skilled groundskeepers beat day-labor hour for hour.
export function groundsCrewHours(state) {
  const dayLabor = (state.maintenance ? state.maintenance.crewUnits : 0) * BALANCE.turf.crewHoursPerDay;
  const staffHours = staffByRole(state, ROLE.GROUNDSKEEPER, { available: true })
    .reduce((a, e) => a + BALANCE.turf.crewHoursPerDay * (0.6 + 0.2 * e.skill), 0);
  return dayLabor + staffHours;
}
