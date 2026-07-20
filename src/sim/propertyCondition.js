import { clamp } from '../core/utils.js';
import { ZONE, HOLE_STATUS } from './constants.js';
import { conditionRating } from './turf.js';
import { shopCondition, exteriorScore, RENO } from './shop.js';
import { exteriorWashScore, ownedWasher } from './washing.js';
import { hasUpgrade } from './progression.js';
import { SHOP_CATALOG, RETAIL_CATS, skuById } from '../data/shopItems.js';

export const CONDITION_CATEGORIES = [
  'clubhouseStructure', 'clubhouseCleanliness', 'clubhouseFurnishing', 'retailReadiness',
  'safetyUtilityReadiness', 'courseTurf', 'greens', 'fairways', 'bunkers', 'irrigation',
  'equipment', 'landscaping', 'customerAccessibility',
];

export const CONDITION_LABELS = {
  clubhouseStructure: 'Clubhouse structure',
  clubhouseCleanliness: 'Clubhouse cleanliness',
  clubhouseFurnishing: 'Clubhouse furnishing',
  retailReadiness: 'Retail readiness',
  safetyUtilityReadiness: 'Safety & utility readiness',
  courseTurf: 'Course turf',
  greens: 'Greens',
  fairways: 'Fairways',
  bunkers: 'Bunkers',
  irrigation: 'Irrigation',
  equipment: 'Equipment',
  landscaping: 'Landscaping',
  customerAccessibility: 'Customer accessibility',
};

const WEIGHTS = {
  clubhouseStructure: 0.07,
  clubhouseCleanliness: 0.09,
  clubhouseFurnishing: 0.06,
  retailReadiness: 0.08,
  safetyUtilityReadiness: 0.06,
  courseTurf: 0.12,
  greens: 0.11,
  fairways: 0.08,
  bunkers: 0.06,
  irrigation: 0.07,
  equipment: 0.06,
  landscaping: 0.07,
  customerAccessibility: 0.07,
};

const r1 = (value) => Math.round(clamp(Number(value) || 0, 0, 100) * 10) / 10;
const mean = (values, fallback = 0) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;

function turfZoneScore(state, zone) {
  if (!state.turf) return 0;
  const scores = [];
  for (let index = 0; index < state.course.zones.length; index += 1) {
    if (state.course.zones[index] !== zone) continue;
    const health = state.turf.health[index] || 0;
    const wear = state.turf.wear[index] || 0;
    const disease = state.turf.disSev[index] || 0;
    scores.push(clamp(health * 0.72 + (100 - wear) * 0.18 + (100 - disease) * 0.1, 0, 100));
  }
  return r1(mean(scores));
}

function bunkerConditionScore(state) {
  if (!state.turf) return 0;
  const wear = [];
  for (let index = 0; index < state.course.zones.length; index += 1) {
    if (state.course.zones[index] === ZONE.BUNKER) wear.push(state.turf.wear[index] || 0);
  }
  return r1(100 - mean(wear, 100));
}

function category(id, score, reasons, sources) {
  return {
    id: `condition:${id}`,
    key: id,
    label: CONDITION_LABELS[id],
    score: r1(score),
    reasons: reasons.filter(Boolean),
    sources: sources.map((source) => ({ ...source, value: r1(source.value) })),
  };
}

export function propertyConditionBreakdown(state) {
  const reno = state.shop?.reno;
  const exteriorJobs = exteriorScore(state) * 100;
  const washed = exteriorWashScore(state) * 100;
  const shop = shopCondition(state);
  const grime = reno?.grime?.length ? mean(reno.grime) : 1;
  const windowDirt = reno?.windows?.length ? mean(reno.windows) : 1;
  const clutterDone = reno?.clutter?.length
    ? reno.clutter.filter((item) => item.cleared).length / reno.clutter.length * 100
    : 100;
  const lightReady = reno?.exterior?.light ? 0 : 100;

  const decor = new Map();
  for (const placed of reno?.decor || []) {
    const contributionId = `decor:${placed.skuId}:spot-${placed.spot}`;
    const sku = skuById(placed.skuId);
    decor.set(contributionId, (sku?.finish || 0));
  }
  const decorFinish = [...decor.values()].reduce((sum, value) => sum + value, 0);
  const furnishing = clamp(decorFinish / Math.max(1, RENO.finishCap) * 100, 0, 100);

  const retail = SHOP_CATALOG.filter((sku) => RETAIL_CATS.has(sku.cat) && sku.tier <= (state.shop?.unlockedTier || 1));
  const stocked = retail.filter((sku) => (state.shop?.inventory?.[sku.id]?.shelf || 0) > 0).length;
  const stockedRatio = retail.length ? stocked / retail.length * 100 : 100;

  const openHoles = state.course.holes.filter((hole) => hole.status === HOLE_STATUS.OPEN).length;
  const openRatio = state.course.holes.length ? openHoles / state.course.holes.length * 100 : 0;
  const course = conditionRating(state);
  const greens = turfZoneScore(state, ZONE.GREEN);
  const fairways = turfZoneScore(state, ZONE.FAIRWAY);
  const bunkers = bunkerConditionScore(state);

  const policies = Object.values(state.maintenance?.policies || {});
  const irrigated = policies.length
    ? policies.filter((policy) => policy.irrigation && policy.irrigation !== 'off').length / policies.length * 100
    : 0;
  const irrigation = clamp(irrigated * 0.75 + (hasUpgrade(state, 'smartIrrigation') ? 25 : 0), 0, 100);

  const upgrades = ['greensMowerII', 'fairwayMowerII', 'aerator', 'sprayRig', 'smartIrrigation']
    .filter((id) => hasUpgrade(state, id)).length;
  const washerLevel = ownedWasher(state).level || 0;
  const equipment = clamp((state.tractor?.repaired ? 40 : 8) + upgrades * 8 + washerLevel * 10, 0, 100);

  const litter = state.props?.litter || [];
  const litterClear = litter.length ? litter.filter((item) => item.cleared).length / litter.length * 100 : 100;
  const landscaping = exteriorJobs * 0.35 + washed * 0.4 + litterClear * 0.25;
  const accessibility = openRatio * 0.7 + (state.props?.teeSignFixed ? 15 : 0) + exteriorJobs * 0.15;

  const categories = {
    clubhouseStructure: category('clubhouseStructure', exteriorJobs * 0.45 + washed * 0.55,
      [`${Math.round(exteriorJobs)}% of exterior hand repairs complete`, `${Math.round(washed)}% of washable surfaces restored`],
      [{ id: 'exterior:hand-jobs', value: exteriorJobs }, { id: 'exterior:wash-mask', value: washed }]),
    clubhouseCleanliness: category('clubhouseCleanliness', shop * 0.65 + washed * 0.25 + (100 - windowDirt * 100) * 0.1,
      [`Shop condition ${Math.round(shop)}`, `${Math.round((1 - grime) * 100)}% of floor grime cleared`, `${Math.round(washed)}% exterior washed`],
      [{ id: 'clubhouse:shop-condition', value: shop }, { id: 'clubhouse:floor-grime', value: (1 - grime) * 100 }, { id: 'exterior:wash-mask', value: washed }]),
    clubhouseFurnishing: category('clubhouseFurnishing', furnishing,
      [`${decor.size} uniquely placed furnishing${decor.size === 1 ? '' : 's'} contribute ${decorFinish}/${RENO.finishCap} finish`],
      decor.size
        ? [...decor.entries()].map(([id, value]) => ({ id, value: value / Math.max(1, RENO.finishCap) * 100 }))
        : [{ id: 'decor:none-placed', value: 0 }]),
    retailReadiness: category('retailReadiness', stockedRatio * 0.65 + shop * 0.35,
      [`${stocked}/${retail.length} unlocked retail lines stocked`, `Shop condition ${Math.round(shop)}`],
      [{ id: 'retail:stocked-lines', value: stockedRatio }, { id: 'clubhouse:shop-condition', value: shop }]),
    safetyUtilityReadiness: category('safetyUtilityReadiness', clutterDone * 0.45 + lightReady * 0.25 + (100 - windowDirt * 100) * 0.3,
      [`${Math.round(clutterDone)}% clutter cleared`, lightReady ? 'Porch light operational' : 'Porch light still failed', `${Math.round((1 - windowDirt) * 100)}% window film cleared`],
      [{ id: 'clubhouse:clutter', value: clutterDone }, { id: 'clubhouse:porch-light', value: lightReady }, { id: 'clubhouse:windows', value: (1 - windowDirt) * 100 }]),
    courseTurf: category('courseTurf', course, [`Live turf condition ${Math.round(course)}`], [{ id: 'course:turf-rating', value: course }]),
    greens: category('greens', greens, [`Greens health, wear and disease score ${Math.round(greens)}`], [{ id: 'course:greens-live', value: greens }]),
    fairways: category('fairways', fairways, [`Fairways health, wear and disease score ${Math.round(fairways)}`], [{ id: 'course:fairways-live', value: fairways }]),
    bunkers: category('bunkers', bunkers, [`Bunker wear and condition score ${Math.round(bunkers)}`], [{ id: 'course:bunkers-live', value: bunkers }]),
    irrigation: category('irrigation', irrigation,
      [`${Math.round(irrigated)}% of turf policies actively irrigate`, hasUpgrade(state, 'smartIrrigation') ? 'Smart controllers installed' : 'Manual controllers only'],
      [{ id: 'course:irrigation-policies', value: irrigated }, { id: 'upgrade:smartIrrigation', value: hasUpgrade(state, 'smartIrrigation') ? 100 : 0 }]),
    equipment: category('equipment', equipment,
      [state.tractor?.repaired ? 'Course tractor operational' : 'Course tractor still broken', `${upgrades}/5 core maintenance upgrades installed`, `${ownedWasher(state).name} available`],
      [{ id: 'equipment:tractor', value: state.tractor?.repaired ? 100 : 20 }, { id: 'equipment:maintenance-upgrades', value: upgrades / 5 * 100 }, { id: `equipment:washer:${ownedWasher(state).id}`, value: washerLevel / 2 * 100 }]),
    landscaping: category('landscaping', landscaping,
      [`${Math.round(exteriorJobs)}% exterior jobs complete`, `${Math.round(litterClear)}% storm litter cleared`],
      [{ id: 'landscaping:exterior-jobs', value: exteriorJobs }, { id: 'landscaping:litter', value: litterClear }, { id: 'exterior:wash-mask', value: washed }]),
    customerAccessibility: category('customerAccessibility', accessibility,
      [`${openHoles}/${state.course.holes.length} holes open`, state.props?.teeSignFixed ? 'Tee sign repaired' : 'Tee sign damaged'],
      [{ id: 'access:open-holes', value: openRatio }, { id: 'access:tee-sign', value: state.props?.teeSignFixed ? 100 : 0 }, { id: 'access:entrance', value: exteriorJobs }]),
  };

  let overall = 0;
  for (const key of CONDITION_CATEGORIES) overall += categories[key].score * WEIGHTS[key];
  const unresolved = Object.values(categories)
    .filter((item) => item.score < 45)
    .sort((a, b) => a.score - b.score)
    .map((item) => ({ id: `problem:${item.key}`, label: item.label, score: item.score, lossSeverity: r1(45 - item.score) }));

  return {
    overall: r1(overall),
    categories,
    unresolved,
    contributionIds: Object.values(categories).flatMap((item) => item.sources.map((source) => source.id)),
  };
}
