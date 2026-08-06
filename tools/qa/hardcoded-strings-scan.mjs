// ITEM 18 — "externalise EVERY player-facing string and report how many were
// hardcoded".
//
// The report comes first, because the number decides whether the rest of the
// item is a night's work or a month's. src/core/i18n.js already exists with 87
// keys at 100% for en/es/fr, so the question is not "is there a system" but
// "how much of the game goes through it".
//
// What counts as player-facing here — deliberately narrow, so the number is a
// floor rather than a guess:
//   toast(...)      / notify(...)        the two message channels
//   text: '...'     inside el(...)        every DOM label the UI builds
//   label: '...'    / title: '...'        prompts and headings
//   reason: '...'   / hint: '...'         refusals and guidance
// A string already wrapped in t(...) is externalised and does not count.
//
// Run:  node tools/qa/hardcoded-strings-scan.mjs [--list]
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor']);
const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
};

// A literal that reads like prose: has a space, starts with a letter, and is
// long enough not to be an id or a css class.
const PROSE = /^[A-Z(“"']?[A-Za-z][^\n]{6,}$/;
const looksLikeProse = (s) => PROSE.test(s) && /\s/.test(s) && !/^[a-z-]+$/.test(s)
  && !/^[\w.-]+\.(js|png|glb|css|json)$/i.test(s);

const CHANNELS = [
  { name: 'toast', rx: /\btoast\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
  { name: 'notify', rx: /\bnotify\(\s*\{[^}]*?\b(?:message|title)\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
  { name: 'text', rx: /\btext\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
  { name: 'label', rx: /\blabel\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
  { name: 'title', rx: /\btitle\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
  { name: 'reason', rx: /\breason\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
  { name: 'hint', rx: /\bhint\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g },
];

const files = walk('src');
const hits = [];
let externalised = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  externalised += (src.match(/\bt\(\s*['"`]/g) || []).length;
  const lines = src.split('\n');
  let inBlock = false;
  lines.forEach((line, index) => {
    const trimmed = line.trimStart();
    const wasInBlock = inBlock;
    const opens = line.lastIndexOf('/*');
    const closes = line.lastIndexOf('*/');
    if (opens >= 0 && opens > closes) inBlock = true;
    else if (closes >= 0 && closes > opens) inBlock = false;
    if (wasInBlock || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const channel of CHANNELS) {
      channel.rx.lastIndex = 0;
      let m = channel.rx.exec(line);
      while (m) {
        const body = m[2];
        if (looksLikeProse(body)) {
          hits.push({ file, line: index + 1, channel: channel.name, text: body.slice(0, 80) });
        }
        m = channel.rx.exec(line);
      }
    }
  });
}

const byChannel = new Map();
for (const h of hits) byChannel.set(h.channel, (byChannel.get(h.channel) || 0) + 1);
const byFile = new Map();
for (const h of hits) byFile.set(h.file, (byFile.get(h.file) || 0) + 1);

console.log(`HARDCODED player-facing strings: ${hits.length}`);
console.log(`already routed through t(): ${externalised} call sites`);
console.log(`files scanned: ${files.length}, files with hardcoded copy: ${byFile.size}`);
console.log('\nby channel:');
for (const [c, n] of [...byChannel].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${c}`);
console.log('\nworst files:');
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${f}`);
if (process.argv.includes('--list')) {
  console.log('\nall:');
  for (const h of hits) console.log(`  ${h.file}:${h.line} [${h.channel}] ${h.text}`);
}
