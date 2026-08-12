#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { validateGoal24DecodedVideo } from './lib/goal24-video-decode.mjs';

function required(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const [inputArgument, outputArgument] = process.argv.slice(2);
  required(inputArgument && outputArgument,
    'Usage: node tools/qa/goal24-video-decode.mjs <input.json> <output.json>');
  const inputPath = path.resolve(inputArgument);
  const outputPath = path.resolve(outputArgument);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = await validateGoal24DecodedVideo(input);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outputPath,
    presentedFrames: result.presentedFrames,
    markerCount: result.markerResults.length,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
