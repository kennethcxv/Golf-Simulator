import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG_SIGNATURE_BYTES = 8;
const CHUNK_OVERHEAD_BYTES = 12;

function trackedPngs() {
  return execFileSync('git', ['ls-files', '-z', '--', '*.png'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function textKeyword(type, data) {
  if (!['tEXt', 'zTXt', 'iTXt'].includes(type)) return null;
  const separator = data.indexOf(0);
  return separator < 0 ? null : data.subarray(0, separator).toString('latin1');
}

export function stripAuthoringPathMetadata(file) {
  const source = fs.readFileSync(file);
  const output = [source.subarray(0, PNG_SIGNATURE_BYTES)];
  let offset = PNG_SIGNATURE_BYTES;
  let removed = 0;

  while (offset + CHUNK_OVERHEAD_BYTES <= source.length) {
    const length = source.readUInt32BE(offset);
    const chunkEnd = offset + CHUNK_OVERHEAD_BYTES + length;
    if (chunkEnd > source.length) throw new Error(`Malformed PNG chunk in ${file}.`);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (textKeyword(type, data) === 'File') removed += 1;
    else output.push(source.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  if (removed) fs.writeFileSync(file, Buffer.concat(output));
  return removed;
}

function main() {
  const files = process.argv.slice(2);
  const selected = files.length ? files : trackedPngs();
  let changed = 0;
  let chunksRemoved = 0;
  for (const file of selected) {
    const removed = stripAuthoringPathMetadata(file);
    if (!removed) continue;
    changed += 1;
    chunksRemoved += removed;
  }
  process.stdout.write(`${JSON.stringify({ scanned: selected.length, changed, chunksRemoved })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
