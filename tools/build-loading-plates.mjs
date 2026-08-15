// E (Goal 21) — TURN CAPTURED GAME FRAMES INTO SHIPPABLE LOADING PLATES.
//
// Input:  qa/electron/e-loading-plates/*.png   (1920x1080 screenshots of the
//                                               real club, HUD hidden)
// Output: Assets/loading/*.jpg + plates.json   (graded, compressed, manifested)
//
// The grade is deliberate and small: a touch of contrast and saturation so the
// plates hold the eye behind a dark scrim, and a mild unsharp pass because a
// JPEG at this size softens edges the game renders crisply. Nothing that would
// misrepresent how the game actually looks — a loading screen that flatters
// beyond the product is a lie the first frame of gameplay exposes.
//
// JPEG rather than PNG on purpose: these are photographic, they sit behind a
// scrim, and 1920x1080 PNGs would put ~14 MB into a load that is already the
// thing we are apologising for. Also keeps them out of the Assets/**/*.png LFS
// rule, so they stay ordinary files in the repository.
//
//   node tools/build-loading-plates.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SRC = 'qa/electron/e-loading-plates';
const OUT = 'Assets/loading';

// Written by hand, because a loading screen that says where you are is worth
// more than one that says "Loading". Keyed to the plate id.
const CAPTIONS = {
  approach: 'The approach, Pine Hills Municipal',
  porch: 'The clubhouse porch, late light',
  fairway: 'Looking down the first',
  treeline: 'The shed and the treeline',
  shopfront: 'The pro shop windows',
  green: 'A green at first light',
};

function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const winget = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(winget)) {
      if (!/ffmpeg/i.test(pkg)) continue;
      const stack = [path.join(winget, pkg)];
      while (stack.length) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (/^ffmpeg(\.exe)?$/i.test(entry.name)) return full;
        }
      }
    }
  } catch { /* fall through */ }
  return spawnSync('ffmpeg', ['-version']).error ? null : 'ffmpeg';
}

const ffmpeg = findFfmpeg();
if (!ffmpeg) { console.error('ffmpeg not found; set FFMPEG=<path>'); process.exit(3); }
if (!fs.existsSync(SRC)) {
  console.error(`No captures in ${SRC}. Run:`);
  console.error('  node tools/qa/run-electron.cjs tools/qa/electron-e-loading-plates.js --clubhouse=pine-hills-v2');
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.png')).sort();
if (!sources.length) { console.error(`No PNGs in ${SRC}`); process.exit(2); }

const manifest = [];
for (const src of sources) {
  const id = path.basename(src, '.png');
  const dest = path.join(OUT, `${id}.jpg`);
  const r = spawnSync(ffmpeg, [
    '-y', '-i', path.join(SRC, src),
    '-vf', 'scale=1920:-1,eq=contrast=1.06:saturation=1.10:gamma=0.98,unsharp=5:5:0.35',
    '-q:v', '4',
    dest,
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr?.split('\n').slice(-8).join('\n'));
    process.exit(4);
  }
  const bytes = fs.statSync(dest).size;
  manifest.push({ id, file: `${id}.jpg`, caption: CAPTIONS[id] || null, bytes });
  console.log(`  ${id.padEnd(12)} ${(bytes / 1024).toFixed(0).padStart(5)} KB  ${CAPTIONS[id] || ''}`);
}

fs.writeFileSync(
  path.join(OUT, 'plates.json'),
  `${JSON.stringify({ generatedFrom: SRC, plates: manifest }, null, 2)}\n`,
);
const total = manifest.reduce((a, p) => a + p.bytes, 0);
console.log(`\n${manifest.length} plates, ${(total / 1024 / 1024).toFixed(2)} MB total -> ${OUT}`);
if (manifest.some((p) => !p.caption)) {
  console.log('NOTE: a plate has no caption. Add one to CAPTIONS in this file.');
}
