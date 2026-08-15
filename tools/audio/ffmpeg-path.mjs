// The same finder tools/qa/clip-frames.mjs uses: ffmpeg is installed by winget on
// this machine and is NOT on PATH, so every audio tool would otherwise die at its
// first spawn with a misleading ENOENT.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function findFfmpeg(binary = 'ffmpeg') {
  const override = binary === 'ffmpeg' ? process.env.FFMPEG : process.env.FFPROBE;
  if (override && fs.existsSync(override)) return override;
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
          else if (new RegExp(`^${binary}(\\.exe)?$`, 'i').test(entry.name)) return full;
        }
      }
    }
  } catch { /* fall through to PATH */ }
  if (!spawnSync(binary, ['-version']).error) return binary;
  throw new Error(`${binary} not found; set ${binary === 'ffmpeg' ? 'FFMPEG' : 'FFPROBE'}=<path>`);
}
