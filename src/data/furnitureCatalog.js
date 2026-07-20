// PINEHOLLOW FURNITURE & FIT-OUT CATALOG
//
// Every sellable furnishing is one rung in a five-step transformation from a
// struggling municipal shop to an elite country club. This module is pure data:
// purchasing, placement, rendering and UI all consume the same immutable rows.

export const FURNITURE_TIERS = Object.freeze([
  Object.freeze({
    id: 'basic', label: 'Basic', brandTier: 'Municipal', quality: 20,
    unlockLevel: 1, requiredReputation: 0, priceFactor: 1,
    valueFactor: 0.55, color: '#6f746f', accent: '#c9c1ad',
    story: 'An honest starter piece built to make a failing clubhouse operational.',
  }),
  Object.freeze({
    id: 'commercial', label: 'Commercial', brandTier: 'Commercial', quality: 40,
    unlockLevel: 5, requiredReputation: 12, priceFactor: 2,
    valueFactor: 0.82, color: '#4f5c55', accent: '#d0b777',
    story: 'Durable commercial equipment for a club that is earning repeat business.',
  }),
  Object.freeze({
    id: 'retail', label: 'Retail', brandTier: 'Professional Retail', quality: 60,
    unlockLevel: 12, requiredReputation: 28, priceFactor: 5,
    valueFactor: 1.15, color: '#49634f', accent: '#d8bc72',
    story: 'Purpose-built retail furniture with stronger presentation and daily utility.',
  }),
  Object.freeze({
    id: 'boutique', label: 'Boutique', brandTier: 'Boutique', quality: 80,
    unlockLevel: 22, requiredReputation: 52, priceFactor: 10,
    valueFactor: 1.55, color: '#234b38', accent: '#c9a85e',
    story: 'A refined statement piece for a destination club with discerning members.',
  }),
  Object.freeze({
    id: 'luxury', label: 'Luxury', brandTier: 'Heritage Country Club', quality: 96,
    unlockLevel: 35, requiredReputation: 78, priceFactor: 22,
    valueFactor: 2.15, color: '#15372a', accent: '#d8b65d',
    story: 'Bespoke country-club craftsmanship that makes the room feel truly elite.',
  }),
]);

export const FURNITURE_CATEGORIES = Object.freeze({
  'retail-displays': Object.freeze({ label: 'Retail displays', shape: 'rack' }),
  'counters-desks': Object.freeze({ label: 'Counters & desks', shape: 'counter' }),
  seating: Object.freeze({ label: 'Seating', shape: 'seat' }),
  tables: Object.freeze({ label: 'Tables', shape: 'table' }),
  storage: Object.freeze({ label: 'Storage', shape: 'shelf' }),
  lighting: Object.freeze({ label: 'Lighting', shape: 'light' }),
  architectural: Object.freeze({ label: 'Architectural finishes', shape: 'finish' }),
  decor: Object.freeze({ label: 'Decor & prestige', shape: 'decor' }),
  'guest-facilities': Object.freeze({ label: 'Guest facilities', shape: 'facility' }),
  operations: Object.freeze({ label: 'Operations & outdoor', shape: 'cart' }),
});

// [id, category, base name, tier nouns, base price, maintenance, comfort,
// prestige, model family, description]. Values describe the basic rung; tier
// multipliers deliberately make high-end pieces meaningful rather than reskins.
const FAMILY_DEFS = [
  ['apparel-rack', 'retail-displays', 'Apparel rack', ['Rolling rack', 'Pipe rack', 'Apparel bay', 'Wardrobe display', 'Built-in wardrobe'], 150, 3, 1, 1, 'apparel-rack', 'Keeps hanging polos and outerwear faced, reachable and easy to restock.'],
  ['folded-apparel-table', 'retail-displays', 'Folded apparel table', ['Laminate fold table', 'Oak-edged fold table', 'Merchandising table', 'Tailored display table', 'Haberdashery island'], 180, 2, 1, 1, 'display-table', 'Presents folded apparel without turning the sales floor into a stock pile.'],
  ['shoe-display', 'retail-displays', 'Shoe display', ['Wire shoe rack', 'Boarded shoe rack', 'Fitting display', 'Backlit shoe wall', 'Bespoke fitting gallery'], 170, 3, 1, 1, 'shoe-display', 'Supports try-on merchandising with organized pairs and clear sizing.'],
  ['cap-display', 'retail-displays', 'Cap display', ['Peg cap stand', 'Slat cap panel', 'Retail cap tower', 'Millinery wall', 'Club crest hat gallery'], 95, 2, 0, 1, 'cap-display', 'Turns small headwear into a readable, high-conversion display.'],
  ['club-rack', 'retail-displays', 'Golf club rack', ['Utility club rack', 'Commercial club rack', 'Fitting rack', 'Boutique club wall', 'Luxury built-in club gallery'], 150, 4, 0, 2, 'club-rack', 'Stores full-length clubs safely while keeping shafts, heads and price cards visible.'],
  ['putter-display', 'retail-displays', 'Putter display', ['Putter barrel', 'Putter rail', 'Practice putter bay', 'Boutique putting wall', 'Master fitter putter studio'], 145, 3, 0, 2, 'putter-display', 'Creates a dedicated, damage-safe presentation for putters and fitting stock.'],
  ['ball-display', 'retail-displays', 'Golf ball display', ['Case stacker', 'Commercial ball shelf', 'Brand ball wall', 'Illuminated ball library', 'Member ball concierge wall'], 150, 4, 0, 1, 'ball-display', 'Holds dense boxed inventory with clear brand and price separation.'],
  ['accessory-display', 'retail-displays', 'Accessory display', ['Pegboard panel', 'Slatwall bay', 'Accessory gondola', 'Boutique accessory cabinet', 'Curated essentials gallery'], 125, 3, 0, 1, 'accessory-display', 'Organizes gloves, tees, towels and small impulse products.'],
  ['bag-display', 'retail-displays', 'Golf bag display', ['Bag floor stand', 'Commercial bag rail', 'Bag fitting platform', 'Boutique bag podium', 'Caddie-room bag gallery'], 220, 3, 0, 2, 'bag-display', 'Supports heavy golf bags upright while preserving an inviting fitting aisle.'],
  ['feature-gondola', 'retail-displays', 'Feature gondola', ['Wire gondola', 'Boarded gondola', 'Retail feature island', 'Boutique launch island', 'Seasonal collection pavilion'], 190, 4, 0, 2, 'feature-gondola', 'Creates a flexible central focal point for launches and seasonal promotions.'],
  ['wall-display', 'retail-displays', 'Built-in wall display', ['Open wall shelf', 'Commercial wall run', 'Retail display wall', 'Boutique cabinetry wall', 'Luxury full-height display'], 240, 5, 0, 2, 'wall-display', 'Uses the room perimeter for high-capacity merchandising without choking aisles.'],
  ['mannequin', 'retail-displays', 'Apparel mannequin', ['Torso form', 'Commercial dress form', 'Sport mannequin', 'Boutique athlete mannequin', 'Sculpted club ambassador'], 75, 1, 0, 2, 'mannequin', 'Shows complete apparel looks and raises the perceived quality of nearby stock.'],

  ['checkout-counter', 'counters-desks', 'Checkout counter', ['Laminate checkout', 'Commercial checkout', 'Retail service counter', 'Boutique walnut counter', 'Handcrafted member-services counter'], 300, 5, 1, 2, 'checkout-counter', 'Anchors the transaction with room for scanning, payment, bagging and guest conversation.'],
  ['reception-desk', 'counters-desks', 'Reception desk', ['Utility reception desk', 'Commercial reception desk', 'Golf reception station', 'Boutique welcome desk', 'Concierge reception suite'], 325, 4, 1, 2, 'reception-desk', 'Gives arrivals a clear staffed destination and dignified first impression.'],
  ['office-desk', 'counters-desks', 'Office desk', ['Laminate office desk', 'Commercial pedestal desk', 'Manager workstation', 'Executive walnut desk', 'Club secretary partners desk'], 300, 3, 2, 1, 'office-desk', 'Supports scheduling, ordering and club administration behind the scenes.'],
  ['back-counter', 'counters-desks', 'Back counter', ['Utility back counter', 'Commercial storage counter', 'Service work counter', 'Boutique fitted counter', 'Full-height service cabinetry'], 280, 5, 0, 1, 'back-counter', 'Adds protected work surface and organized storage behind the service line.'],

  ['office-chair', 'seating', 'Office chair', ['Task chair', 'Commercial task chair', 'Ergonomic manager chair', 'Leather executive chair', 'Hand-tufted club chair'], 150, 1, 4, 0, 'office-chair', 'Improves staff comfort during ordering, scheduling and long administrative sessions.'],
  ['lounge-armchair', 'seating', 'Lounge armchair', ['Vinyl lounge chair', 'Commercial lounge chair', 'Upholstered club chair', 'Buttoned leather armchair', 'Hand-tufted reading chair'], 250, 1, 6, 1, 'lounge-armchair', 'Gives waiting guests a comfortable single seat with a composed silhouette.'],
  ['lounge-sofa', 'seating', 'Lounge sofa', ['Vinyl settee', 'Commercial sofa', 'Upholstered lounge sofa', 'Buttoned leather sofa', 'Bespoke Chesterfield sofa'], 420, 2, 10, 2, 'lounge-sofa', 'Creates a social waiting area that makes the clubhouse feel hospitable.'],
  ['waiting-bench', 'seating', 'Waiting bench', ['Utility bench', 'Commercial oak bench', 'Cushioned waiting bench', 'Boutique hall bench', 'Carved member bench'], 150, 1, 4, 1, 'bench', 'Provides compact seating near fitting, reception and member-service areas.'],
  ['dining-chair', 'seating', 'Dining chair', ['Stacking chair', 'Commercial dining chair', 'Upholstered dining chair', 'Boutique spindle chair', 'Crested member dining chair'], 90, 1, 4, 1, 'dining-chair', 'Supports café and event seating with increasing comfort and ceremony.'],
  ['bar-stool', 'seating', 'Bar stool', ['Steel stool', 'Commercial counter stool', 'Upholstered bar stool', 'Walnut club stool', 'Brass-footed member stool'], 85, 1, 3, 1, 'bar-stool', 'Adds compact counter seating for refreshments and informal member conversation.'],

  ['coffee-table', 'tables', 'Coffee table', ['Laminate coffee table', 'Commercial oak table', 'Walnut lounge table', 'Boutique brass-inlay table', 'Marquetry member lounge table'], 120, 1, 2, 1, 'coffee-table', 'Completes lounge groupings and supports drinks, magazines and small displays.'],
  ['side-table', 'tables', 'Side table', ['Utility side table', 'Commercial end table', 'Walnut lamp table', 'Boutique pedestal table', 'Hand-inlaid drinks table'], 80, 1, 1, 1, 'side-table', 'Puts a useful surface beside guest seating without crowding circulation.'],
  ['dining-table', 'tables', 'Dining table', ['Folding table', 'Commercial dining table', 'Oak hospitality table', 'Boutique refectory table', 'Grand member dining table'], 240, 2, 3, 2, 'dining-table', 'Supports food service, events and member gatherings as the club matures.'],
  ['conference-table', 'tables', 'Meeting table', ['Utility meeting table', 'Commercial meeting table', 'Boardroom table', 'Executive walnut table', 'Club governors table'], 360, 2, 3, 2, 'conference-table', 'Creates a professional place for staff planning, committees and private events.'],

  ['stock-shelving', 'storage', 'Stockroom shelving', ['Wire utility shelf', 'Boarded metal shelf', 'Retail stock system', 'Fitted stock cabinetry', 'Inventory archive wall'], 150, 8, 0, 0, 'stock-shelving', 'Increases organized back-stock capacity and reduces daily handling friction.'],
  ['storage-cabinet', 'storage', 'Storage cabinet', ['Utility cabinet', 'Commercial steel cabinet', 'Oak service cabinet', 'Boutique fitted cabinet', 'Full-height walnut storage'], 180, 6, 0, 1, 'storage-cabinet', 'Hides supplies, tools and paperwork behind a clean, maintainable front.'],
  ['member-locker', 'storage', 'Member locker', ['Steel locker', 'Commercial locker', 'Ventilated oak locker', 'Boutique club locker', 'Named walnut member locker'], 220, 4, 2, 2, 'member-locker', 'Adds secure changing-room storage and a stronger sense of membership.'],
  ['filing-cabinet', 'storage', 'Filing cabinet', ['Two-drawer file', 'Commercial file cabinet', 'Manager filing credenza', 'Boutique document cabinet', 'Club archive cabinet'], 95, 2, 0, 0, 'filing-cabinet', 'Keeps reservations, invoices and staff records orderly and accessible.'],
  ['storage-bench', 'storage', 'Storage bench', ['Utility storage bench', 'Commercial boot bench', 'Cushioned locker bench', 'Boutique changing bench', 'Crested member storage bench'], 175, 3, 3, 1, 'storage-bench', 'Combines seated changing comfort with discreet equipment storage.'],

  ['ceiling-flush', 'lighting', 'Flush ceiling light', ['Strip light', 'Commercial panel light', 'Recessed light set', 'Architectural ceiling light', 'Coffered ambient light'], 60, 2, 0, 1, 'ceiling-flush', 'Provides dependable general illumination with progressively warmer, cleaner output.'],
  ['recessed-light', 'lighting', 'Recessed lighting', ['Single downlight', 'Commercial downlight set', 'Retail recessed grid', 'Boutique warm downlights', 'Gallery-grade pin lighting'], 70, 2, 0, 1, 'recessed-light', 'Adds controlled pools of light without competing with merchandise.'],
  ['track-light', 'lighting', 'Track lighting', ['Utility track', 'Commercial track', 'Retail accent track', 'Boutique adjustable track', 'Museum-grade display track'], 95, 3, 0, 2, 'track-light', 'Aims flexible accent light at feature displays as the shop evolves.'],
  ['pendant-light', 'lighting', 'Pendant light', ['Enamel pendant', 'Commercial dome pendant', 'Brass retail pendant', 'Linen drum pendant', 'Cut-glass club pendant'], 80, 2, 0, 1, 'pendant-light', 'Drops warm visual focus over counters, tables and lounge groupings.'],
  ['chandelier', 'lighting', 'Chandelier', ['Simple branched light', 'Commercial ring light', 'Brass chandelier', 'Crystal club chandelier', 'Grand heritage chandelier'], 180, 3, 0, 4, 'chandelier', 'Turns the ceiling into a prestige landmark for arrivals and events.'],
  ['wall-sconce', 'lighting', 'Wall sconce', ['Utility wall light', 'Commercial sconce', 'Brass cup sconce', 'Boutique shade sconce', 'Heritage library sconce'], 40, 1, 0, 1, 'wall-sconce', 'Softens walls and circulation routes with restrained warm light.'],
  ['picture-light', 'lighting', 'Picture light', ['Clip picture light', 'Commercial display light', 'Brass picture light', 'Boutique gallery light', 'Conservator art light'], 45, 1, 0, 2, 'picture-light', 'Highlights club art, honors and historic photographs without glare.'],
  ['floor-lamp', 'lighting', 'Floor lamp', ['Utility floor lamp', 'Commercial reading lamp', 'Brass lounge lamp', 'Boutique linen-shade lamp', 'Sculpted member lounge lamp'], 65, 1, 1, 1, 'floor-lamp', 'Adds human-scale light and warmth beside lounge seating.'],
  ['desk-lamp', 'lighting', 'Desk lamp', ['Clamp lamp', 'Commercial task lamp', 'Bankers desk lamp', 'Boutique brass task lamp', 'Hand-finished library lamp'], 35, 1, 0, 1, 'desk-lamp', 'Improves focused work light at office, reception and checkout desks.'],

  ['flooring', 'architectural', 'Flooring', ['Sealed concrete', 'Commercial tile', 'Large-format stone tile', 'Walnut plank floor', 'Herringbone hardwood floor'], 2, 8, 1, 1, 'flooring', 'Changes the room-wide walking surface from municipal utility to country-club finish.', [2, 4, 7, 12, 20], 'sq-ft'],
  ['ceiling-treatment', 'architectural', 'Ceiling treatment', ['Acoustic tile', 'Smooth commercial ceiling', 'Coffered ceiling', 'Timber beam ceiling', 'Ornamental club ceiling'], 2, 5, 1, 1, 'ceiling-treatment', 'Raises the perceived height and polish of the entire clubhouse.', [2, 3, 6, 10, 18], 'sq-ft'],
  ['interior-door', 'architectural', 'Interior door', ['Hollow-core door', 'Commercial panel door', 'Solid oak door', 'Glazed arched door', 'Handcrafted member door'], 300, 3, 1, 1, 'interior-door', 'Improves privacy, acoustics and the quality of transitions between rooms.', [300, 500, 1000, 1800, 3500]],
  ['exterior-door', 'architectural', 'Exterior door', ['Painted entry door', 'Commercial entry set', 'Solid oak entry', 'Glazed club entry', 'Grand double member entry'], 450, 5, 0, 2, 'exterior-door', 'Strengthens the clubhouse threshold and the first impression from outside.', [450, 800, 1500, 2800, 5200]],
  ['window-treatment', 'architectural', 'Window treatment', ['Roller blind', 'Commercial solar shade', 'Lined drapery', 'Boutique timber blind', 'Tailored club drapery'], 90, 2, 2, 1, 'window-treatment', 'Controls glare and makes the room feel considered from inside and out.'],
  ['wall-paneling', 'architectural', 'Wall finish', ['Painted wall finish', 'Commercial wall protection', 'Oak wainscot', 'Boutique paneled wall', 'Full-height heritage paneling'], 110, 6, 1, 2, 'wall-paneling', 'Carries the Pinehollow cream, green and walnut palette across the room.'],

  ['area-rug', 'decor', 'Area rug', ['Utility mat', 'Commercial woven rug', 'Golf motif rug', 'Boutique wool rug', 'Hand-knotted club crest rug'], 120, 2, 3, 1, 'area-rug', 'Softens lounge acoustics and visually anchors furniture groupings.'],
  ['wall-art', 'decor', 'Wall art', ['Course print', 'Framed course map', 'Golf photography set', 'Commissioned landscape', 'Club heritage painting'], 60, 1, 0, 2, 'wall-art', 'Builds identity through golf, place and the club’s growing story.'],
  ['trophy-case', 'decor', 'Trophy display', ['Open trophy shelf', 'Commercial trophy case', 'Lit honors cabinet', 'Boutique trophy gallery', 'Grand champions wall'], 220, 3, 0, 4, 'trophy-case', 'Turns competitive history into visible prestige for guests and members.'],
  ['plant', 'decor', 'Interior planting', ['Potted hardy plant', 'Commercial planter', 'Sculptural indoor tree', 'Boutique planting group', 'Conservatory specimen'], 45, 4, 2, 1, 'plant', 'Adds living color and softens hard retail and architectural edges.'],
  ['mirror', 'decor', 'Mirror', ['Utility mirror', 'Commercial fitting mirror', 'Oak framed mirror', 'Boutique brass mirror', 'Full-height member mirror'], 70, 1, 1, 1, 'mirror', 'Supports fitting rooms while making compact areas feel larger and brighter.'],
  ['clock', 'decor', 'Clubhouse clock', ['Utility wall clock', 'Commercial station clock', 'Brass club clock', 'Boutique regulator clock', 'Handmade heritage clock'], 40, 1, 0, 1, 'clock', 'Keeps operations legible and adds a familiar clubhouse detail.'],
  ['signage', 'decor', 'Wayfinding signage', ['Printed sign set', 'Commercial wayfinding', 'Oak room plaques', 'Boutique brass signs', 'Engraved heritage sign system'], 55, 3, 0, 2, 'signage', 'Makes reception, fitting, facilities and member areas easy to understand.'],

  ['restroom-vanity', 'guest-facilities', 'Restroom vanity', ['Utility sink stand', 'Commercial vanity', 'Solid-surface vanity', 'Boutique oak vanity', 'Stone member washstand'], 260, 5, 2, 1, 'restroom-vanity', 'Upgrades an essential guest facility with better durability and finish.'],
  ['restroom-stall', 'guest-facilities', 'Restroom partition', ['Painted partition', 'Commercial laminate stall', 'Solid compact stall', 'Boutique paneled stall', 'Private member washroom partition'], 320, 6, 1, 1, 'restroom-stall', 'Improves privacy and turns a neglected facility into a credible club amenity.'],
  ['towel-station', 'guest-facilities', 'Towel station', ['Wire towel basket', 'Commercial towel shelf', 'Fitted towel cabinet', 'Boutique linen station', 'Attendant towel console'], 85, 4, 2, 1, 'towel-station', 'Keeps guest towels presented, stocked and easy to maintain.'],
  ['hydration-station', 'guest-facilities', 'Hydration station', ['Water jug stand', 'Commercial cooler', 'Bottle refill station', 'Boutique refreshment console', 'Member hydration bar'], 120, 5, 3, 1, 'hydration-station', 'Adds a welcome refreshment touch for golfers, shoppers and events.'],

  ['golf-cart', 'operations', 'Golf cart', ['Two-seat utility cart', 'Canopy cart', 'Four-seat windshield cart', 'Lithium hospitality cart', 'Six-seat enclosed club cart'], 4500, 8, 3, 2, 'golf-cart', 'Moves guests and staff with progressively stronger range, comfort and presentation.', [4500, 6500, 9500, 14500, 22000]],
  ['cart-storage', 'operations', 'Cart storage', ['Outdoor cart rail', 'Commercial cart shelter', 'Charging cart bay', 'Boutique cart pavilion', 'Enclosed fleet house'], 600, 10, 0, 1, 'cart-storage', 'Protects and organizes the growing cart fleet near the clubhouse.'],
  ['patio-set', 'operations', 'Patio furniture', ['Folding patio set', 'Commercial patio set', 'Cushioned terrace set', 'Boutique teak terrace', 'Member veranda collection'], 240, 3, 6, 2, 'patio-set', 'Extends clubhouse hospitality outdoors for waiting, events and post-round visits.'],
  ['porch-bench', 'operations', 'Porch bench', ['Utility porch bench', 'Commercial slat bench', 'Cushioned arrival bench', 'Boutique oak settle', 'Crested country-club bench'], 150, 2, 4, 1, 'porch-bench', 'Makes the entry feel useful and welcoming before a guest reaches the door.'],
  ['waste-station', 'operations', 'Waste station', ['Utility bin', 'Commercial sorting station', 'Concealed waste cabinet', 'Boutique service station', 'Integrated clubhouse recycling wall'], 90, 8, 0, 0, 'waste-station', 'Improves daily maintenance and keeps guest-facing areas free of loose waste.'],
];

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function thumbnailDataUri(name, category, tier) {
  const shape = FURNITURE_CATEGORIES[category].shape;
  const silhouettes = {
    rack: '<path d="M72 118V48h176v70M88 78h144M102 78v38m34-38v38m34-38v38m34-38v38"/>',
    counter: '<path d="M58 62h204v64H58zM82 82h52m20 0h82M86 126v18m148-18v18"/>',
    seat: '<path d="M92 74h136v48H92zM78 54h28v68H78zm136 0h28v68h-28M108 122l-10 24m114-24l10 24"/>',
    table: '<path d="M54 70h212v24H54zM84 94v52m152-52v52M112 94h96"/>',
    shelf: '<path d="M70 42h180v106H70zM70 76h180M70 112h180M94 42v106m132-106v106"/>',
    light: '<path d="M160 28v34M112 72h96l-18 34h-60zM160 106v18M144 126h32"/>',
    finish: '<path d="M60 42h200v106H60zM60 78h200M104 42v106m64-106v106m44-106v106"/>',
    decor: '<path d="M88 40h144v102H88zM108 118l34-34 22 22 22-34 26 46z"/>',
    facility: '<path d="M76 48h168v94H76zM96 70h54v50H96zm76 0h52v18h-52zm0 34h52"/>',
    cart: '<path d="M58 92h204l-18 34H82zM96 126a14 14 0 1 0 1 0m126 0a14 14 0 1 0 1 0M94 92V54h126l24 38"/>',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${tier.color}"/><stop offset="1" stop-color="#17231d"/></linearGradient></defs>
    <rect width="320" height="180" rx="18" fill="url(#g)"/><rect x="10" y="10" width="300" height="160" rx="12" fill="none" stroke="${tier.accent}" stroke-width="2" opacity=".65"/>
    <g fill="none" stroke="${tier.accent}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${silhouettes[shape]}</g>
    <rect x="18" y="142" width="284" height="26" rx="7" fill="#101713" opacity=".88"/>
    <text x="28" y="160" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#f6f0de">${escapeXml(name)}</text>
    <text x="292" y="31" text-anchor="end" font-family="Arial,sans-serif" font-size="12" font-weight="700" fill="${tier.accent}">${tier.label.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const WALL_FAMILIES = new Set(['picture-light', 'wall-sconce', 'wall-art', 'mirror', 'clock', 'signage']);
const CEILING_FAMILIES = new Set(['ceiling-flush', 'recessed-light', 'track-light', 'pendant-light', 'chandelier']);
const SURFACE_FAMILIES = new Set(['desk-lamp']);
const INSTALLATION_FAMILIES = new Set([
  'flooring', 'ceiling-treatment', 'interior-door', 'exterior-door',
  'window-treatment', 'wall-paneling', 'restroom-stall',
]);
const VEHICLE_FAMILIES = new Set(['golf-cart', 'cart-storage']);

function placementModeFor(familyId) {
  if (WALL_FAMILIES.has(familyId)) return 'wall';
  if (CEILING_FAMILIES.has(familyId)) return 'ceiling';
  if (SURFACE_FAMILIES.has(familyId)) return 'surface';
  if (INSTALLATION_FAMILIES.has(familyId)) return 'installation';
  if (VEHICLE_FAMILIES.has(familyId)) return 'vehicle';
  return 'floor';
}

function familyRows(definition) {
  const [familyId, category, baseName, tierNouns, basePrice, maintenance, comfort,
    prestige, modelFamily, baseDescription, explicitPrices = null, unit = 'each'] = definition;
  const ids = FURNITURE_TIERS.map((tier) => `${familyId}-${tier.id}`);
  return FURNITURE_TIERS.map((tier, index) => {
    const name = `${tier.label} ${tierNouns[index]}`;
    const valueFactor = tier.valueFactor;
    return Object.freeze({
      id: ids[index],
      familyId,
      progressionTier: tier.id,
      progressionIndex: index,
      previousId: ids[index - 1] || null,
      nextId: ids[index + 1] || null,
      progression: Object.freeze([...ids]),
      name,
      price: explicitPrices ? explicitPrices[index] : Math.max(1, Math.round(basePrice * tier.priceFactor / 5) * 5),
      priceUnit: unit,
      quality: tier.quality,
      qualityLabel: tier.label,
      brandTier: tier.brandTier,
      description: `${baseDescription} ${tier.story}`,
      thumbnail: thumbnailDataUri(name, category, tier),
      category,
      unlockLevel: tier.unlockLevel,
      requiredReputation: tier.requiredReputation,
      maintenanceValue: Math.max(0, Math.round(maintenance * valueFactor)),
      comfortValue: Math.max(0, Math.round(comfort * valueFactor)),
      prestigeValue: Math.max(0, Math.round(prestige * valueFactor)),
      modelFamily,
      placementMode: placementModeFor(familyId),
      isPurchasable: true,
    });
  });
}

export const FURNITURE_FAMILIES = Object.freeze(FAMILY_DEFS.map((definition) => Object.freeze({
  id: definition[0],
  category: definition[1],
  label: definition[2],
  itemIds: Object.freeze(FURNITURE_TIERS.map((tier) => `${definition[0]}-${tier.id}`)),
})));

export const FURNITURE_CATALOG = Object.freeze(FAMILY_DEFS.flatMap(familyRows));
export const FURNITURE_BY_ID = Object.freeze(Object.fromEntries(FURNITURE_CATALOG.map((item) => [item.id, item])));

export function furnitureById(id) {
  return FURNITURE_BY_ID[id] || null;
}

export function furnitureFamily(familyId) {
  return FURNITURE_FAMILIES.find((family) => family.id === familyId) || null;
}

export function furnitureCatalogForCategory(category) {
  return FURNITURE_CATALOG.filter((item) => item.category === category);
}

export function validateFurnitureCatalog(catalog = FURNITURE_CATALOG) {
  const errors = [];
  const ids = new Set();
  const required = [
    'price', 'quality', 'brandTier', 'description', 'thumbnail', 'category',
    'unlockLevel', 'requiredReputation', 'maintenanceValue', 'comfortValue', 'prestigeValue',
  ];
  for (const item of catalog) {
    if (!item?.id || ids.has(item.id)) errors.push(`duplicate or missing id: ${item?.id || '<missing>'}`);
    ids.add(item?.id);
    for (const field of required) {
      if (!Object.hasOwn(item, field) || item[field] == null || item[field] === '') errors.push(`${item.id}.${field}`);
    }
    if (!(item.price > 0) || !(item.quality >= 0 && item.quality <= 100)) errors.push(`${item.id}.economy`);
    if (!Object.hasOwn(FURNITURE_CATEGORIES, item.category)) errors.push(`${item.id}.category`);
    if (!Array.isArray(item.progression) || item.progression.length !== FURNITURE_TIERS.length) errors.push(`${item.id}.progression`);
  }
  for (const family of FURNITURE_FAMILIES) {
    const rows = family.itemIds.map((id) => FURNITURE_BY_ID[id]).filter(Boolean);
    if (rows.length !== FURNITURE_TIERS.length) errors.push(`${family.id}.coverage`);
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1];
      const after = rows[index];
      if (after.price <= before.price || after.quality <= before.quality
        || after.unlockLevel <= before.unlockLevel
        || after.requiredReputation <= before.requiredReputation) errors.push(`${family.id}.tier-${index}`);
      if (before.nextId !== after.id || after.previousId !== before.id) errors.push(`${family.id}.links-${index}`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
