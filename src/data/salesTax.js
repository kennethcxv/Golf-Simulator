// WHERE THE COURSE IS, AND WHAT THAT COSTS THE CUSTOMER.
//
// Reported 2026-07-29: "I asked for tax by state. Build it on the right side of the till.
// Wholesale goods bought for resale are exempt from sales tax in the US — the resale
// exemption. So do NOT tax supplier orders… Instead: each property has a STATE, and that
// state's sales-tax rate applies to customer purchases at checkout."
//
// The resale exemption is why BALANCE.wholesaleSalesTaxRate stays at 0 and stays wired: a
// shop buying inventory to resell presents a resale certificate and pays no sales tax on it.
// The tax is collected from the END customer, at the register, and it is not the shop's money
// — it is held for the state and remitted. That is modelled as a liability, not revenue.
//
// ON THE NUMBERS, AND WHERE THEY CAME FROM
//
//   `stateRate` is the STATUTORY statewide rate — the figure in each state's revenue code
//   (California 7.25%, Texas 6.25%, Tennessee 7.00%, Oregon none, and so on). These are the
//   exact published rates and are what makes the spread between properties real.
//
//   `localRate` is ONE representative local add-on for that state, standing in for the
//   county/city layer that a specific course would actually sit inside. It is chosen so the
//   combined figure lands near the state average that the Tax Foundation publishes each year
//   in "State and Local Sales Tax Rates", and it is rounded to a quarter point. It is an
//   approximation on purpose: a single course has ONE jurisdiction, not a state average, and
//   this build could not fetch the current edition to copy averages to the basis point.
//   Treat the statutory rate as exact and the local component as the game's stand-in.
//
//   Five states levy no general sales tax at all (Oregon, Montana, New Hampshire, Delaware,
//   and — for the general retail case — Alaska has no state-level tax). Oregon and Montana are
//   in the table on purpose: a property where the register never adds a cent is a real and
//   instructive thing for the player to own, and it proves the zero path works.

export const SALES_TAX_SOURCE = 'Statutory statewide rates from each state revenue code; '
  + 'local add-on is one representative jurisdiction per state, calibrated to the Tax '
  + 'Foundation "State and Local Sales Tax Rates" state averages and rounded to 0.25%.';

/**
 * Every jurisdiction a property can sit in. `stateRate + localRate` is what the register adds.
 * Kept alphabetical by code so a diff is readable.
 */
export const SALES_TAX_JURISDICTIONS = Object.freeze([
  { code: 'AZ', state: 'Arizona', locality: 'Maricopa County', stateRate: 0.0560, localRate: 0.0280 },
  { code: 'CA', state: 'California', locality: 'Riverside County', stateRate: 0.0725, localRate: 0.0150 },
  { code: 'CO', state: 'Colorado', locality: 'El Paso County', stateRate: 0.0290, localRate: 0.0500 },
  { code: 'FL', state: 'Florida', locality: 'Lee County', stateRate: 0.0600, localRate: 0.0100 },
  { code: 'GA', state: 'Georgia', locality: 'Cherokee County', stateRate: 0.0400, localRate: 0.0300 },
  { code: 'MA', state: 'Massachusetts', locality: 'statewide - no local option', stateRate: 0.0625, localRate: 0 },
  { code: 'MI', state: 'Michigan', locality: 'statewide - no local option', stateRate: 0.0600, localRate: 0 },
  { code: 'MT', state: 'Montana', locality: 'no general sales tax', stateRate: 0, localRate: 0 },
  { code: 'NC', state: 'North Carolina', locality: 'Moore County', stateRate: 0.0475, localRate: 0.0225 },
  { code: 'NY', state: 'New York', locality: 'Suffolk County', stateRate: 0.0400, localRate: 0.0450 },
  { code: 'OH', state: 'Ohio', locality: 'Summit County', stateRate: 0.0575, localRate: 0.0150 },
  { code: 'OR', state: 'Oregon', locality: 'no general sales tax', stateRate: 0, localRate: 0 },
  { code: 'SC', state: 'South Carolina', locality: 'Horry County', stateRate: 0.0600, localRate: 0.0150 },
  { code: 'TN', state: 'Tennessee', locality: 'Williamson County', stateRate: 0.0700, localRate: 0.0275 },
  { code: 'TX', state: 'Texas', locality: 'Comal County', stateRate: 0.0625, localRate: 0.0200 },
  { code: 'WI', state: 'Wisconsin', locality: 'Waukesha County', stateRate: 0.0500, localRate: 0.0050 },
]);

const BY_CODE = new Map(SALES_TAX_JURISDICTIONS.map((j) => [j.code, j]));

// Where every property this game ships with is. Each was chosen to fit what its blurb already
// says about the land — Saltgrass Point is coastal scrub, Quarry Bluffs has "the most
// elevation change in the county" — and to spread the tax burden across the roster so buying
// the next course is a decision about more than acreage.
export const DEFAULT_PROPERTY_JURISDICTION = 'NC';
export const PROPERTY_JURISDICTIONS = Object.freeze({
  'willow-creek': 'NC',        // Pine Hills Municipal — sandhills muni, 7.00% combined
  'bent-pines': 'MI',          // northern pines, no local option, a flat 6.00%
  'flatiron-meadows': 'OH',    // pancake-flat midwestern parkland, 7.25%
  'saltgrass-point': 'SC',     // coastal scrub and wind, 7.50%
  'thornbury-estate': 'NY',    // sprawling estate eighteen, 8.50% — the expensive one
  'quarry-bluffs': 'CO',       // the most elevation change in the county, 7.90%
  'cypress-hollow': 'TX',      // water everywhere, hill-country creek bottom, 8.25%
  'fairview-commons': 'OR',    // grandpa's course, and the register adds nothing at all
});

// Generated listings roll from this ring rather than the whole table, so a run of new
// listings still spans zero-tax to high-tax instead of clustering.
export const GENERATED_JURISDICTION_RING = Object.freeze([
  'NC', 'TX', 'FL', 'AZ', 'TN', 'OR', 'GA', 'CA', 'WI', 'MA', 'MT', 'NY',
]);

export function salesTaxJurisdiction(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || BY_CODE.get(DEFAULT_PROPERTY_JURISDICTION);
}

/** The rate the register adds, state plus local, rounded to five places. */
export function salesTaxRateOf(code) {
  const j = salesTaxJurisdiction(code);
  return Math.round((j.stateRate + j.localRate) * 1e5) / 1e5;
}

/** '7.5%' — trailing zeros trimmed, because "7.50%" reads like false precision on a receipt. */
export function formatTaxRate(rate) {
  const pct = (Number(rate) || 0) * 100;
  if (pct === 0) return '0%';
  return `${pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/** The jurisdiction a property record names, falling back to its id's authored home. */
export function jurisdictionForProperty(property) {
  const explicit = property && property.taxJurisdiction;
  if (explicit && BY_CODE.has(String(explicit).toUpperCase())) return salesTaxJurisdiction(explicit);
  const byId = property && PROPERTY_JURISDICTIONS[property.id];
  if (byId) return salesTaxJurisdiction(byId);
  return salesTaxJurisdiction(DEFAULT_PROPERTY_JURISDICTION);
}
