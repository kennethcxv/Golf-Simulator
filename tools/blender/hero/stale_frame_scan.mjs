// A STALE FRAME IS WORSE THAN A BLANK ONE.
//
// A blank frame fails the gate. A stale frame passes every check and lies: it
// is a real render of a real asset, just not of the asset as it is now.
//
// Twice in one night. The rake's Cycles `rake-under.png` stayed blank while its
// EEVEE twin was cured, and then the spray bottle cost two fixes that both
// worked while I reviewed `spray-eevee-hero.png` -- a file hours old, because
// that builder writes no `-eevee` suffix and the frame I wanted was
// `spray-hero.png`. The suffix convention is not the same in every builder and
// there is no reason it should have to be.
//
// So: flag any frame OLDER than the builder that makes it.
//
//   node tools/blender/hero/stale_frame_scan.mjs [--gate]
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const HERO = path.join('tools', 'blender', 'hero');
const QA = path.join('qa', 'hero');
const gate = process.argv.includes('--gate');

// qa/hero/<dir> is produced by build_<dir>.py unless the name differs
const ALIAS = { apparel_v2: null, register_c: 'lane_head', register_options: 'register_options',
                _control: null, softgoods: 'softgoods', shelving: null, smoke: null };

function builderFor(dir) {
  if (dir in ALIAS) { if (!ALIAS[dir]) return null; dir = ALIAS[dir]; }
  const p = path.join(HERO, `build_${dir}.py`);
  return existsSync(p) ? p : null;
}

const rows = [];
for (const dir of readdirSync(QA)) {
  const full = path.join(QA, dir);
  if (!statSync(full).isDirectory()) continue;
  const builder = builderFor(dir);
  if (!builder) continue;
  const bt = statSync(builder).mtimeMs;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const fp = path.join(d, f);
      const st = statSync(fp);
      if (st.isDirectory()) { walk(fp); continue; }
      if (!f.endsWith('.png')) continue;
      if (st.mtimeMs < bt) {
        rows.push({ file: path.relative(QA, fp), hours: (bt - st.mtimeMs) / 3.6e6 });
      }
    }
  };
  walk(full);
}

rows.sort((a, b) => b.hours - a.hours);
for (const r of rows.slice(0, 40)) {
  console.log(`STALE  ${r.hours.toFixed(1).padStart(6)} h older than its builder   ${r.file}`);
}
console.log(`${rows.length} frames are older than the builder that makes them`);
if (gate && rows.length) {
  console.log('\nA frame older than its builder is not evidence about the current');
  console.log('asset. Re-render it, or delete it so it cannot be cited.');
  process.exit(1);
}
