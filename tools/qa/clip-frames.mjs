// SECTION Y (Goal 21) — TURN A CLIP INTO FRAMES YOU CAN ACTUALLY LOOK AT.
//
// A screenshot cannot show a gesture, and the gesture is what keeps failing: the
// ledger opening, the double set-down, a customer walking into a box, the mop's
// stroke. Every one of those was reported done off a still or a number.
//
// So the standing rule is a clip, and a clip is worthless unless the frames are
// VIEWED. This makes that cheap:
//
//   1. record          VIDEO_DIR=qa/clips/ledger node tools/qa/run-electron.cjs <driver> --clubhouse=pine-hills-v2
//   2. extract         node tools/qa/clip-frames.mjs qa/clips/ledger
//   3. LOOK            read the tile sheet, then any single frame it points at
//
// It writes:
//   frames/frame-####.png   one per sampled frame, named by its TIMESTAMP so the
//                           report can cite "the course change at 3.40 s"
//   tiles-##.png            contact sheets, for reading the whole gesture at once
//   frames/index.json       frame -> timestamp, so a claim can name a frame
//
// Usage:
//   node tools/qa/clip-frames.mjs <dir-or-file> [--fps 10] [--width 640] [--grid 6x5]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function findFfmpeg() {
  // an explicit override always wins
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  // the winget install on this machine, which is not on PATH
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const winget = path.join(
    home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages',
  );
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
  } catch { /* fall through to PATH */ }
  // ...and finally whatever is on PATH
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (!probe.error) return 'ffmpeg';
  return null;
}

function newestVideo(target) {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (!stat) throw new Error(`No such path: ${target}`);
  if (stat.isFile()) return target;
  const videos = fs.readdirSync(target)
    .filter((f) => /\.(webm|mp4|mkv)$/i.test(f))
    .map((f) => ({ f: path.join(target, f), t: fs.statSync(path.join(target, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!videos.length) throw new Error(`No clip in ${target}. Did the run use VIDEO_DIR?`);
  return videos[0].f;
}

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node tools/qa/clip-frames.mjs <dir-or-file> [--fps 10] [--width 640] [--grid 6x5]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const fps = Number(flag('fps', 10));
const width = Number(flag('width', 640));
const grid = String(flag('grid', '6x5'));
const [cols, rows] = grid.split('x').map(Number);

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error('ffmpeg not found. Set FFMPEG=<path> or install it.');
  process.exit(3);
}

const video = newestVideo(target);
const outDir = fs.statSync(target).isFile() ? path.dirname(target) : target;
const framesDir = path.join(outDir, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const run = (cliArgs) => {
  const r = spawnSync(ffmpeg, cliArgs, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr?.split('\n').slice(-12).join('\n'));
    throw new Error(`ffmpeg failed: ${cliArgs.join(' ')}`);
  }
  return r;
};

// individual frames, so a report can cite one
run(['-y', '-i', video, '-vf', `fps=${fps},scale=${width}:-1`,
  path.join(framesDir, 'frame-%04d.png')]);

// contact sheets, so the whole gesture can be read at once
run(['-y', '-i', video, '-vf',
  `fps=${fps},scale=${width}:-1,tile=${cols}x${rows}:padding=4:color=0x202020`,
  path.join(outDir, 'tiles-%02d.png')]);

const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
// Frame N is sampled at (N-1)/fps seconds. Writing it down is the difference
// between "it happens near the start" and "the course changes at 1.30 s".
const index = frames.map((f, i) => ({
  frame: f,
  seconds: +(i / fps).toFixed(2),
  tile: `tiles-${String(Math.floor(i / (cols * rows)) + 1).padStart(2, '0')}.png`,
  cell: (i % (cols * rows)) + 1,
}));
fs.writeFileSync(path.join(framesDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const sheets = fs.readdirSync(outDir).filter((f) => /^tiles-\d+\.png$/.test(f)).sort();
console.log(`clip      ${video}`);
console.log(`frames    ${frames.length} at ${fps} fps  ->  ${framesDir}`);
console.log(`duration  ${(frames.length / fps).toFixed(2)} s`);
console.log(`sheets    ${sheets.join(', ')}`);
console.log('NOW LOOK AT THEM. A number about a clip nobody viewed is not evidence.');
