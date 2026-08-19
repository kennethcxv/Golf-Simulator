const j = require('./read-run.cjs')(process.argv[2]);
const r = j.result || j;
for (const k of ['indoorPress', 'outdoorPress']) {
  const p = r[k]; if (!p) continue;
  console.log(`== ${k}  ${p.where}`);
  console.log(`   settled census ${p.settledCensus}  (settled=${p.censusSettled} after ${p.censusSettledAfterMs} ms)`);
  console.log(`   history ${JSON.stringify(p.censusHistory)}`);
  console.log(`   minted  ${p.rows.filter((x) => x.minted).map((x) => `${x.tool}+${x.minted}`).join(' ') || 'none'}`);
  console.log(`   worst block ms  ${p.rows.map((x) => `${x.tool}:${x.worstBlockMs}`).join('  ')}`);
}
console.log('indoorWalk ', JSON.stringify(r.indoorWalk));
console.log('outdoorWalk', JSON.stringify(r.outdoorWalk));
console.log('viewmodels ', JSON.stringify(r.viewmodels));
