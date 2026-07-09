// FAIRWAY STATE — name generators for golfers, staff, and corporate outing clients.

const FIRST = [
  'Marcus', 'Rita', 'Dale', 'Priya', 'Walt', 'June', 'Hector', 'Nadia', 'Gordon', 'Elaine',
  'Ray', 'Bonnie', 'Curtis', 'Ivy', 'Stan', 'Marisol', 'Doug', 'Renee', 'Vern', 'Tasha',
  'Phil', 'Carmen', 'Russ', 'Dot', 'Amir', 'Sue', 'Lloyd', 'Greta', 'Ted', 'Yolanda',
  'Bram', 'Kiko', 'Earl', 'Fern', 'Otis', 'Lena', 'Chip', 'Rosa', 'Hank', 'Mabel',
  'Sonny', 'Vera', 'Cliff', 'Nia', 'Buck', 'Opal', 'Reggie', 'Twyla', 'Moe', 'Sadie',
];

const LAST = [
  'Reed', 'Okafor', 'Lindqvist', 'Barnes', 'Castillo', 'Nguyen', 'Whitfield', 'Marsh',
  'Kowalski', 'Bell', 'Ferreira', 'Slate', 'Hong', 'Abernathy', 'Cruz', 'Dunlap',
  'Iversen', 'Pratt', 'Osei', 'Vance', 'Mercer', 'Holt', 'Segura', 'Blackwood',
  'Tanaka', 'Royce', 'Whitaker', 'Fontaine', 'Grady', 'Ostrowski', 'Pike', 'Lambros',
  'Chavez', 'Redmond', 'Sorensen', 'Beltran', 'Hux', 'Ainsley', 'Draper', 'Kirby',
];

const CO_A = [
  'Apex', 'Bluestone', 'Cardinal', 'Meridian', 'Pinnacle', 'Harbor', 'Keystone', 'Summit',
  'Vantage', 'Ironwood', 'Crestline', 'Beacon', 'Stirling', 'Redbrick', 'Northfield', 'Quarry',
];

const CO_B = [
  'Logistics', 'Insurance', 'Dental Group', 'Realty', 'Manufacturing', 'Software',
  'Financial', 'Medical Partners', 'Construction', 'Law Group', 'Distributors', 'Engineering',
];

export function genName(rng) {
  return `${FIRST[rng.int(FIRST.length)]} ${LAST[rng.int(LAST.length)]}`;
}

export function genCompany(rng) {
  return `${CO_A[rng.int(CO_A.length)]} ${CO_B[rng.int(CO_B.length)]}`;
}
