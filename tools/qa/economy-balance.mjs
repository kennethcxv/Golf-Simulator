import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  newEmpire, buyProperty, activeState, empireUpdate, holdingValue, requestPropertyAppraisal,
} from '../../src/sim/empire.js';
import { SHOP_CATALOG, RETAIL_CATS } from '../../src/data/shopItems.js';
import { shelfCapacity, restockShelfFromBackroom, placeDecor } from '../../src/sim/shop.js';
import { addExpense, financialSummary } from '../../src/sim/economy.js';
import {
  setGreenFee, setMembershipDue, setProductMarkup, setRentalPrice, teePricingResponse,
} from '../../src/sim/pricing.js';
import { purchaseUpgrade } from '../../src/sim/progression.js';
import { propertyConditionBreakdown } from '../../src/sim/propertyCondition.js';
import { propertyReadiness } from '../../src/sim/propertyProgression.js';
import { reputationSnapshot } from '../../src/sim/reputation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(root, process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || 'qa/economy-progression');
const DAYS = 24;
const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function restoreClubhouse(state) {
  state.shop.reno.grime.fill(0);
  state.shop.reno.windows.fill(0);
  for (const item of state.shop.reno.clutter) item.cleared = true;
  const exterior = state.shop.reno.exterior;
  exterior.weeds.fill(0);
  exterior.gutter = 0;
  exterior.cobwebs = 0;
  exterior.light = 0;
  exterior.siding.fill(0);
  for (const surface of Object.values(state.shop.reno.wash || {})) {
    surface.grime.fill(0);
    surface.soap.fill(0);
  }
  for (const item of state.props.litter) item.cleared = true;
  state.props.teeSignFixed = true;
  state.tractor.repaired = true;

  const decor = SHOP_CATALOG.filter((sku) => sku.cat === 'decor').slice(0, 6);
  for (const sku of decor) {
    state.shop.inventory[sku.id].back = Math.max(1, state.shop.inventory[sku.id].back);
    placeDecor(state, sku.id, 0);
  }
}

function restoreCourse(state) {
  state.turf.health.fill(82);
  state.turf.moisture.fill(58);
  state.turf.nutrients.fill(62);
  state.turf.wear.fill(2);
  state.turf.disSev.fill(0);
  state.turf.disType.fill(0);
  state.maintenance.crewUnits = 2;
  for (const policy of Object.values(state.maintenance.policies)) {
    policy.irrigation = policy === state.maintenance.policies.rough ? 'light' : 'standard';
    policy.fertilizer = 'lean';
  }
}

function neglectCourse(state) {
  state.turf.health.fill(18);
  state.turf.moisture.fill(12);
  state.turf.nutrients.fill(10);
  state.turf.wear.fill(78);
  state.turf.disSev.fill(72);
  for (const policy of Object.values(state.maintenance.policies)) {
    policy.irrigation = 'off';
    policy.fertilizer = 'none';
    policy.mowEveryDays = 30;
  }
  state.maintenance.crewUnits = 1;
}

function applyPriceProfile(state, profile) {
  const markup = profile === 'high' ? 1.5 : profile === 'low' ? 0.7 : 1;
  for (const category of Object.keys(state.shop.markup)) setProductMarkup(state, category, markup);
  if (profile === 'high') {
    setGreenFee(state, 150);
    setRentalPrice(state, 60);
    for (const tier of Object.keys(state.club.dues)) setMembershipDue(state, tier, 2000);
  } else if (profile === 'low') {
    setGreenFee(state, 10);
    setRentalPrice(state, 5);
    for (const tier of Object.keys(state.club.dues)) setMembershipDue(state, tier, 100);
  } else {
    setGreenFee(state, Math.round(teePricingResponse(state).fairValue));
  }
}

function procureAndRestock(state, scenarioId, day, tier, bufferFactor) {
  let goods = 0;
  let units = 0;
  for (const sku of SHOP_CATALOG) {
    if (!RETAIL_CATS.has(sku.cat) || sku.tier > tier) continue;
    const inventory = state.shop.inventory[sku.id];
    const capacity = shelfCapacity(sku);
    const target = capacity + Math.ceil(capacity * bufferFactor);
    const needed = Math.max(0, target - inventory.shelf - inventory.back);
    if (needed > 0) {
      inventory.back += needed;
      units += needed;
      goods += sku.cost * needed;
    }
    restockShelfFromBackroom(state, sku.id);
  }
  goods = r2(goods);
  if (goods > 0) {
    addExpense(state, 'shopOrders', goods, {
      idempotencyKey: `balance:${scenarioId}:day-${day}:inventory`,
      relatedId: `${scenarioId}:day-${day}`,
      description: `Accelerated ${scenarioId} inventory replenishment`,
      source: 'balance-scenario',
      accountingClass: 'inventory',
      units,
    });
    addExpense(state, 'deliveryCosts', Math.max(15, r2(goods * 0.04)), {
      idempotencyKey: `balance:${scenarioId}:day-${day}:delivery`,
      relatedId: `${scenarioId}:day-${day}`,
      description: `Accelerated ${scenarioId} delivery charge`,
      source: 'balance-scenario',
      accountingClass: 'inventory',
    });
  }
}

function emptyRetail(state) {
  for (const sku of SHOP_CATALOG) {
    if (!RETAIL_CATS.has(sku.cat)) continue;
    state.shop.inventory[sku.id].shelf = 0;
    state.shop.inventory[sku.id].back = 0;
  }
}

const scenarios = [
  { id: 'poor-operation', label: 'Poor operation', seed: 7101, price: 'high', stock: 'none', quality: 'neglected' },
  { id: 'average-operation', label: 'Average operation', seed: 7101, price: 'fair', stock: 'basic', quality: 'default' },
  { id: 'skilled-operation', label: 'Skilled operation', seed: 7101, price: 'fair', stock: 'full', quality: 'restored', upgrades: ['greensMowerII', 'aerator'] },
  { id: 'fair-price-control', label: 'Fair-price control', seed: 7101, price: 'fair', stock: 'full', quality: 'default' },
  { id: 'high-price', label: 'High-price strategy', seed: 7101, price: 'high', stock: 'full', quality: 'default' },
  { id: 'low-price', label: 'Low-price strategy', seed: 7101, price: 'low', stock: 'full', quality: 'default' },
  { id: 'understocked', label: 'Understocked store', seed: 7101, price: 'fair', stock: 'none', quality: 'default' },
  { id: 'neglected-course', label: 'Neglected course', seed: 7101, price: 'fair', stock: 'full', quality: 'neglected-course' },
  { id: 'fully-restored', label: 'Fully restored property', seed: 7101, price: 'fair', stock: 'full', quality: 'restored', upgrades: ['greensMowerII', 'aerator', 'smartIrrigation'] },
];

function configure(state, scenario) {
  if (scenario.quality === 'restored') {
    restoreClubhouse(state);
    restoreCourse(state);
  } else if (scenario.quality === 'neglected-course') {
    restoreClubhouse(state);
    neglectCourse(state);
  } else if (scenario.quality === 'neglected') {
    neglectCourse(state);
  }
  applyPriceProfile(state, scenario.price);
  if (scenario.stock === 'none') emptyRetail(state);
  else procureAndRestock(state, scenario.id, 0, scenario.stock === 'full' ? 2 : 1, scenario.stock === 'full' ? 1.2 : 0.5);

  if (scenario.upgrades?.length) {
    state.progression.prestige = 100;
    for (const upgrade of scenario.upgrades) purchaseUpgrade(state, upgrade);
  }
}

function runScenario(scenario) {
  const empire = newEmpire('relaxed', scenario.seed);
  const purchase = buyProperty(empire, 'willow-creek');
  if (!purchase.ok) throw new Error(`${scenario.id}: ${purchase.reason}`);
  const state = activeState(empire);
  configure(state, scenario);
  empire.cash = state.cash;

  const startCash = empire.cash;
  const startValue = holdingValue(empire, empire.holdings[0]);
  const startCondition = propertyConditionBreakdown(state).overall;
  let minimumCash = startCash;
  let negativeDays = 0;
  for (let day = 0; day < DAYS; day += 1) {
    if (scenario.stock !== 'none') {
      const cadence = scenario.stock === 'full' ? 3 : 7;
      if (day > 0 && day % cadence === 0) {
        procureAndRestock(state, scenario.id, day, scenario.stock === 'full' ? 2 : 1, scenario.stock === 'full' ? 1.2 : 0.5);
      } else {
        for (const sku of SHOP_CATALOG) {
          if (RETAIL_CATS.has(sku.cat)) restockShelfFromBackroom(state, sku.id);
        }
      }
    }
    empireUpdate(empire, 1440);
    minimumCash = Math.min(minimumCash, empire.cash);
    if (empire.cash < 0) negativeDays += 1;
  }

  const endState = activeState(empire);
  const finance = financialSummary(endState, 0, DAYS - 1);
  const periodEntries = endState.ledger.entries.filter((entry) => entry.day >= 0 && entry.day < DAYS);
  const retailRevenue = r2(periodEntries.filter((entry) => entry.category === 'shopSales' && entry.direction === 'revenue').reduce((sum, entry) => sum + entry.amount, 0));
  const retailCostOfGoods = r2(periodEntries.filter((entry) => entry.category === 'costOfGoods').reduce((sum, entry) => sum + entry.amount, 0));
  const summaries = endState.ledger.dailySummaries.filter((summary) => summary.day >= 0 && summary.day < DAYS);
  const condition = propertyConditionBreakdown(endState);
  const reputation = reputationSnapshot(endState);
  const readiness = propertyReadiness(endState, empire);
  const appraisal = requestPropertyAppraisal(empire, 'willow-creek').appraisal;
  const endValue = holdingValue(empire, empire.holdings[0]);
  const averageDailyProfit = r2(finance.netProfit / Math.max(1, summaries.length));
  const cheapestUpgrade = 5000;
  const daysToCheapestUpgrade = averageDailyProfit > 0 ? r2(cheapestUpgrade / averageDailyProfit) : null;
  return {
    id: scenario.id,
    label: scenario.label,
    days: DAYS,
    assumptions: { price: scenario.price, stock: scenario.stock, quality: scenario.quality, upgrades: scenario.upgrades || [] },
    cash: { start: r2(startCash), end: r2(empire.cash), change: r2(empire.cash - startCash), minimum: r2(minimumCash), negativeDays },
    profit: {
      grossRevenue: finance.grossRevenue,
      costOfGoodsSold: finance.costOfGoodsSold,
      operatingExpenses: finance.operatingExpenses,
      net: finance.netProfit,
      averageDaily: averageDailyProfit,
      retailRevenue,
      retailCostOfGoods,
      retailGrossMargin: r2(retailRevenue - retailCostOfGoods),
      revenueByCategory: finance.revenueByCategory,
      expenseByCategory: finance.expenseByCategory,
    },
    operations: {
      customersServed: summaries.reduce((sum, summary) => sum + summary.customersServed, 0),
      missedSales: summaries.reduce((sum, summary) => sum + summary.missedSales, 0),
      noShowImpact: r2(summaries.reduce((sum, summary) => sum + summary.noShowImpact, 0)),
      averageTeeUtilization: r2(summaries.reduce((sum, summary) => sum + summary.teeTimeUtilization, 0) / Math.max(1, summaries.length)),
    },
    property: {
      acquisitionCost: endState.property.acquisitionCost || 0,
      startCondition,
      endCondition: condition.overall,
      startValue,
      endValue,
      valueChange: endValue - startValue,
      unresolvedAreas: condition.unresolved.length,
      saleEligible: readiness.saleEligible,
      offer: appraisal.offer,
      netProceeds: appraisal.netProceeds,
      offerVsAcquisition: r2(appraisal.netProceeds - (endState.property.acquisitionCost || 0)),
    },
    reputation,
    progression: {
      daysToCheapestUpgrade,
      nextTierEligibleBeforeRequiredSale: readiness.nextTierEligible,
    },
  };
}

const BALANCE_SEEDS = [7101, 7102, 7103, 7104, 7105];
const mean = (runs, read) => r2(runs.reduce((sum, run) => sum + (Number(read(run)) || 0), 0) / runs.length);
const rate = (runs, read) => r2(runs.filter(read).length / runs.length);
const averageBuckets = (runs, read) => {
  const keys = new Set(runs.flatMap((run) => Object.keys(read(run) || {})));
  return Object.fromEntries([...keys].sort().map((key) => [key, mean(runs, (run) => read(run)?.[key] || 0)]));
};

function averageRuns(scenario, runs) {
  return {
    id: scenario.id,
    label: scenario.label,
    days: DAYS,
    replicates: runs.length,
    assumptions: runs[0].assumptions,
    cash: {
      start: mean(runs, (run) => run.cash.start), end: mean(runs, (run) => run.cash.end),
      change: mean(runs, (run) => run.cash.change), minimum: mean(runs, (run) => run.cash.minimum),
      negativeDays: mean(runs, (run) => run.cash.negativeDays), negativeRunRate: rate(runs, (run) => run.cash.negativeDays > 0),
    },
    profit: {
      grossRevenue: mean(runs, (run) => run.profit.grossRevenue),
      costOfGoodsSold: mean(runs, (run) => run.profit.costOfGoodsSold),
      operatingExpenses: mean(runs, (run) => run.profit.operatingExpenses),
      net: mean(runs, (run) => run.profit.net), averageDaily: mean(runs, (run) => run.profit.averageDaily),
      retailRevenue: mean(runs, (run) => run.profit.retailRevenue),
      retailCostOfGoods: mean(runs, (run) => run.profit.retailCostOfGoods),
      retailGrossMargin: mean(runs, (run) => run.profit.retailGrossMargin),
      revenueByCategory: averageBuckets(runs, (run) => run.profit.revenueByCategory),
      expenseByCategory: averageBuckets(runs, (run) => run.profit.expenseByCategory),
    },
    operations: {
      customersServed: mean(runs, (run) => run.operations.customersServed),
      missedSales: mean(runs, (run) => run.operations.missedSales),
      noShowImpact: mean(runs, (run) => run.operations.noShowImpact),
      averageTeeUtilization: mean(runs, (run) => run.operations.averageTeeUtilization),
    },
    property: {
      acquisitionCost: mean(runs, (run) => run.property.acquisitionCost),
      startCondition: mean(runs, (run) => run.property.startCondition),
      endCondition: mean(runs, (run) => run.property.endCondition),
      startValue: mean(runs, (run) => run.property.startValue), endValue: mean(runs, (run) => run.property.endValue),
      valueChange: mean(runs, (run) => run.property.valueChange),
      unresolvedAreas: mean(runs, (run) => run.property.unresolvedAreas),
      saleEligible: rate(runs, (run) => run.property.saleEligible) >= 0.5,
      saleEligibleRate: rate(runs, (run) => run.property.saleEligible),
      offer: mean(runs, (run) => run.property.offer), netProceeds: mean(runs, (run) => run.property.netProceeds),
      offerVsAcquisition: mean(runs, (run) => run.property.offerVsAcquisition),
    },
    reputation: {
      overall: mean(runs, (run) => run.reputation.overall),
      categories: Object.fromEntries(Object.keys(runs[0].reputation.categories).map((category) => [category, mean(runs, (run) => run.reputation.categories[category])])),
    },
    progression: {
      daysToCheapestUpgrade: mean(runs.filter((run) => run.progression.daysToCheapestUpgrade != null), (run) => run.progression.daysToCheapestUpgrade) || null,
      nextTierEligibleBeforeRequiredSale: runs.some((run) => run.progression.nextTierEligibleBeforeRequiredSale),
    },
  };
}

const scenarioRuns = scenarios.map((scenario) => ({
  id: scenario.id,
  runs: BALANCE_SEEDS.map((seed) => runScenario({ ...scenario, seed })),
}));
const results = scenarios.map((scenario) => averageRuns(scenario, scenarioRuns.find((batch) => batch.id === scenario.id).runs));
const byId = Object.fromEntries(results.map((result) => [result.id, result]));
const findings = {
  maxPriceAlwaysWins: byId['high-price'].profit.net >= byId['fair-price-control'].profit.net,
  lowPriceAlwaysWins: byId['low-price'].profit.net >= byId['fair-price-control'].profit.net,
  skilledBeatsAverage: byId['skilled-operation'].profit.net > byId['average-operation'].profit.net,
  understockingHurts: byId.understocked.profit.retailGrossMargin < byId['average-operation'].profit.retailGrossMargin
    && byId.understocked.operations.missedSales > byId['average-operation'].operations.missedSales,
  understockedNetProfitBelowAverage: byId.understocked.profit.net < byId['average-operation'].profit.net,
  neglectedCourseHurts: byId['neglected-course'].profit.net < byId['skilled-operation'].profit.net,
  poorTutorialBankruptcy: byId['poor-operation'].cash.negativeRunRate > 0,
  averageInstantWealth: byId['average-operation'].profit.net >= byId['average-operation'].property.acquisitionCost,
  restoredSaleMeaningful: byId['fully-restored'].property.saleEligible
    && byId['fully-restored'].property.netProceeds > byId['fully-restored'].property.acquisitionCost,
  averageUpgradeDays: byId['average-operation'].progression.daysToCheapestUpgrade,
  skilledUpgradeDays: byId['skilled-operation'].progression.daysToCheapestUpgrade,
  immediateNextTierBypass: results.some((result) => result.progression.nextTierEligibleBeforeRequiredSale),
};

const artifact = {
  generatedAt: new Date().toISOString(),
  horizonDays: DAYS,
  assumptions: [
    'Every scenario buys the same Willow Creek property in Relaxed mode and runs the real daily empire update for 24 closed days across five deterministic seed replicates.',
    'Each strategy uses the same five-seed set, plus the real weather, customers, membership, turf, pricing, ledger, reputation, and valuation systems; tables report replicate means.',
    'Accelerated stocked scenarios collapse unpacking lead time: replenishment enters the real inventory and posts merchandise plus 4% delivery cash entries before shelves are refilled.',
    'Poor and understocked scenarios receive no replenishment. High/low strategies change every supported price control to its legal bound and are compared with a matched fair-price control using the same full stock and default condition.',
    'Restored fixtures mutate the same grime, clutter, wash masks, turf arrays, equipment, decor placements, and maintenance policies that normal gameplay changes; they do not write condition or value directly.',
    'Upgrade attainability divides the cheapest $5,000 progression upgrade by observed accounting profit and excludes restoration capital from operating profit.',
  ],
  scenarios: results,
  scenarioRuns,
  findings,
};

const money = (value) => `$${Math.round(value).toLocaleString('en-US')}`;
const lines = [
  '# Economy progression balance report',
  '',
  `Deterministic 24-day accelerated run across ${results.length} required scenarios and ${BALANCE_SEEDS.length} matched seed replicates each. Full inputs and category results are in \`simulated-scenarios.json\`.`,
  '',
  '| Scenario | Net profit | Cash change | Customers | Missed | Condition | Value change | Net sale |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...results.map((result) => `| ${result.label} | ${money(result.profit.net)} | ${money(result.cash.change)} | ${result.operations.customersServed} | ${result.operations.missedSales} | ${result.property.endCondition} | ${money(result.property.valueChange)} | ${money(result.property.netProceeds)} |`),
  '',
  '## Checks',
  '',
  `- Maximum prices do not always win: **${findings.maxPriceAlwaysWins ? 'FAIL' : 'PASS'}**.`,
  `- Minimum prices do not always win: **${findings.lowPriceAlwaysWins ? 'FAIL' : 'PASS'}**.`,
  `- Skilled operation beats average operation: **${findings.skilledBeatsAverage ? 'PASS' : 'FAIL'}**.`,
  `- Understocking reduces retail gross margin and increases missed sales: **${findings.understockingHurts ? 'PASS' : 'FAIL'}** (${money(byId.understocked.profit.retailGrossMargin)} vs ${money(byId['average-operation'].profit.retailGrossMargin)} retail margin; ${Math.round(byId.understocked.operations.missedSales)} vs ${Math.round(byId['average-operation'].operations.missedSales)} missed).`,
  `- Understocked whole-business net trails average after matched-seed averaging: **${findings.understockedNetProfitBelowAverage ? 'PASS' : 'WARN'}**.`,
  `- Course neglect underperforms skilled restoration: **${findings.neglectedCourseHurts ? 'PASS' : 'FAIL'}**.`,
  `- Poor tutorial operation avoids unrecoverable bankruptcy: **${findings.poorTutorialBankruptcy ? 'FAIL' : 'PASS'}** (minimum cash ${money(byId['poor-operation'].cash.minimum)}).`,
  `- Average operation avoids instant wealth inside one 24-day season: **${findings.averageInstantWealth ? 'FAIL' : 'PASS'}** (${money(byId['average-operation'].profit.net)} profit vs ${money(byId['average-operation'].property.acquisitionCost)} acquisition).`,
  `- A restored property makes selling a meaningful unlocked option: **${findings.restoredSaleMeaningful ? 'PASS' : 'FAIL'}** (${money(byId['fully-restored'].property.netProceeds)} net sale proceeds).`,
  `- Next tier cannot bypass its required sale: **${findings.immediateNextTierBypass ? 'FAIL' : 'PASS'}**.`,
  `- Cheapest upgrade pace: average ${findings.averageUpgradeDays ?? 'not attainable'} days; skilled ${findings.skilledUpgradeDays ?? 'not attainable'} days at observed operating profit.`,
  '',
  '## Assumptions',
  '',
  ...artifact.assumptions.map((assumption) => `- ${assumption}`),
  '',
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'simulated-scenarios.json'), `${JSON.stringify(artifact, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'balance-report.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ outDir, findings, scenarios: results.map((result) => ({
  id: result.id, net: result.profit.net, cash: result.cash.change, condition: result.property.endCondition,
  valueChange: result.property.valueChange, eligible: result.property.saleEligible,
})) }, null, 2));
