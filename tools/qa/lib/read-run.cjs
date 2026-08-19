// Pull the last parseable top-level JSON object out of a run-electron log.
const fs = require('node:fs');
module.exports = function readRun(path) {
  const t = fs.readFileSync(path, 'utf8');
  for (let k = 0; k < t.length; k += 1) {
    if (t[k] !== '{') continue;
    try { return JSON.parse(t.slice(k)); } catch { /* keep looking */ }
  }
  throw new Error(`no JSON object in ${path}`);
};
