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
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
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
const framesStale = rows.length;
if (framesStale) {
  console.log('');
  console.log('A frame older than its builder is not evidence about the');
  console.log('current asset. Re-render it, or delete it so it cannot be cited.');
}

// ------------------------------------------------------------------------
// AND THE SAME QUESTION ABOUT THE EXPORTS, which matters more.
//
// A stale FRAME lies to me. A stale GLB lies to the GAME. Going to wire the
// hero assets I checked this first, and 27 of the 39 exports on disk were
// older than the builder that makes them, by up to 19.7 hours -- the retail
// rack GLB still had 872 triangles in 14 meshes while the builder had been
// making 1,304 in 18 objects for an hour. Wiring any of them would have
// shipped geometry that is neither what the builder makes nor what was
// reviewed and signed off.
//
// The builder-to-export mapping is READ OUT OF THE BUILDERS rather than
// written here. A hand-kept table of which builder makes which file is the
// same fault shape as a hand-kept list of assertion pairs: it goes stale on
// whatever was added last, and silently.
const HERO_GLB = path.join('Assets', 'models', 'hero');

function scanExports() {
  if (!existsSync(HERO_GLB)) return [];
  const owner = new Map();
  const prefixes = [];
  for (const f of readdirSync(HERO)) {
    if (!f.startsWith('build_') || !f.endsWith('.py')) continue;
    const src = readFileSync(path.join(HERO, f), 'utf8');
    for (const m of src.matchAll(/"([a-z0-9_]+)[.]glb"/g)) {
      if (!owner.has(m[1])) owner.set(m[1], f);
    }
    // Several builders name their exports with an f-string --
    // f"apparel_{state}.glb" -- so an exact-literal match calls ten real
    // files UNOWNED. Take the literal PREFIX before the first brace and let
    // it claim anything starting with it.
    for (const m of src.matchAll(/"([a-z0-9_]+)\{/g)) {
      if (m[1].length >= 4) prefixes.push([m[1], f]);
    }
  }
  const out = [];
  for (const g of readdirSync(HERO_GLB)) {
    if (!g.endsWith('.glb')) continue;
    const stem = g.slice(0, -4);
    let b = owner.get(stem);
    if (!b) {
      const hit = prefixes.filter(([pre]) => stem.startsWith(pre))
        .sort((x, y) => y[0].length - x[0].length)[0];
      if (hit) b = hit[1];
    }
    if (!b) { out.push({ file: g, hours: null, builder: null }); continue; }
    const bt = statSync(path.join(HERO, b)).mtimeMs;
    const gt = statSync(path.join(HERO_GLB, g)).mtimeMs;
    if (gt < bt) out.push({ file: g, hours: (bt - gt) / 3.6e6, builder: b });
  }
  return out;
}

const ex = scanExports();
console.log('');
for (const r of ex.filter((r) => r.hours !== null).sort((a, b) => b.hours - a.hours)) {
  console.log(`STALE EXPORT ${r.hours.toFixed(1).padStart(6)} h older than ${r.builder}   ${r.file}`);
}
for (const r of ex.filter((r) => r.hours === null)) {
  console.log(`UNOWNED      no build_*.py names it   ${r.file}`);
}
const staleEx = ex.filter((r) => r.hours !== null).length;
console.log(`${staleEx} exports are STALE; ${ex.length - staleEx} could not be attributed to a builder`);

// Unowned is "I could not work out which builder makes it", which is a
// gap in this tool, not a fault in the asset. Only staleness gates.
if (gate && (framesStale || staleEx)) process.exit(1);
