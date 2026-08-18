// Reference beside result, per garment, every round -- the brief asks for it
// and a reference in another folder is a reference nobody looks at.
//
//   node tools/blender/hero/apparel_vs_ref.mjs
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PAIRS = [
  ['polo-folded', 'polo-folded-stack.jpg', ['hero', 'top']],
  ['polo-hung', 'rack-hung-and-folded.jpg', ['hero', 'front']],
  ['tee-folded', 'tee-folded.jpg', ['hero', 'top']],
  ['tee-hung', 'hoodie-hung.jpg', ['hero', 'front']],
  ['hoodie-folded', 'hoodie-hung.jpg', ['hero', 'top']],
  ['hoodie-hung', 'hoodie-hung.jpg', ['hero', 'front']],
  ['trousers-folded', 'trousers-stack.jpg', ['hero', 'top']],
  ['cap', 'cap.jpg', ['hero', 'front']],
];

for (const [name, ref, views] of PAIRS) {
  const dir = path.join('qa', 'hero', 'apparel', name);
  const shots = views.map((v) => path.join(dir, `${name}-${v}.png`))
    .filter((f) => existsSync(f));
  if (!shots.length) {
    console.log(`skip ${name}: no cycles renders yet`);
    continue;
  }
  const out = path.join(dir, `${name}-vs-ref.png`);
  execFileSync(process.execPath, [
    path.join('tools', 'blender', 'hero', 'side_by_side.mjs'),
    out, path.join('ref', 'apparel', ref), ...shots,
  ], { stdio: 'inherit' });
}
